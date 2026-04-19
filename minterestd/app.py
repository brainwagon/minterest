import os
import json
import sqlite3
import argparse
from datetime import datetime
from flask import Flask, request, jsonify, g, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

app = Flask(__name__)
app.config['DATABASE'] = os.environ.get('MINTEREST_BACKUP_DB', 'minterestd.db')
app.config['MAX_BACKUPS'] = int(os.environ.get('MINTEREST_MAX_BACKUPS', 5))

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(app.config['DATABASE'])
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                data TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.authorization
        if not auth or not auth.username or not auth.password:
            return jsonify({'error': 'Authentication required. Use Basic Auth.'}), 401
        
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE username = ?', (auth.username,)).fetchone()
        
        if not user or not check_password_hash(user['password_hash'], auth.password):
            return jsonify({'error': 'Invalid credentials.'}), 401
            
        g.user = user
        return f(*args, **kwargs)
    return decorated

# Enable CORS for cross-origin requests from the static Minterest frontend
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/')
def index():
    db = get_db()
    user_count = db.execute('SELECT count(*) as count FROM users').fetchone()['count']
    backup_count = db.execute('SELECT count(*) as count FROM backups').fetchone()['count']
    return render_template_string('''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>minterestd</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 2.5rem 3rem; max-width: 420px; width: 100%; }
    .status { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1.5rem; }
    .dot { width: 10px; height: 10px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e; }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
    h1 span { color: #6366f1; }
    .meta { color: #666; font-size: 0.8rem; margin-top: 0.25rem; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 2rem 0; }
    .stat { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1rem; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #6366f1; }
    .stat-label { font-size: 0.75rem; color: #666; margin-top: 0.2rem; }
    .endpoints { border-top: 1px solid #222; padding-top: 1.5rem; }
    .endpoints h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #555; margin-bottom: 0.75rem; }
    .endpoint { font-family: monospace; font-size: 0.85rem; color: #a5b4fc; padding: 0.3rem 0; }
    .method { color: #4ade80; margin-right: 0.5rem; font-size: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status">
      <div class="dot"></div>
      <div>
        <h1>minterest<span>d</span></h1>
        <div class="meta">backup server &mdash; v1.0.0</div>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-value">{{ user_count }}</div>
        <div class="stat-label">registered users</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ backup_count }}</div>
        <div class="stat-label">stored backups</div>
      </div>
    </div>
    <div class="endpoints">
      <h2>API Endpoints</h2>
      <div class="endpoint"><span class="method">POST</span>/api/register</div>
      <div class="endpoint"><span class="method">GET</span>/api/backups</div>
      <div class="endpoint"><span class="method">POST</span>/api/backups</div>
      <div class="endpoint"><span class="method">GET</span>/api/backups/:id</div>
      <div class="endpoint"><span class="method">DELETE</span>/api/backups/:id</div>
    </div>
  </div>
</body>
</html>''', user_count=user_count, backup_count=backup_count)

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password required.'}), 400
        
    db = get_db()
    try:
        db.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            (data['username'], generate_password_hash(data['password']))
        )
        db.commit()
        return jsonify({'message': 'User created successfully.'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username already exists.'}), 400

@app.route('/api/backups', methods=['GET'])
@requires_auth
def list_backups():
    db = get_db()
    backups = db.execute(
        'SELECT id, timestamp FROM backups WHERE user_id = ? ORDER BY timestamp DESC',
        (g.user['id'],)
    ).fetchall()
    return jsonify([dict(b) for b in backups])

MAX_BACKUP_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB

@app.route('/api/backups', methods=['POST'])
@requires_auth
def create_backup():
    content_length = request.content_length
    if content_length is not None and content_length > MAX_BACKUP_BYTES:
        return jsonify({'error': 'Backup exceeds maximum allowed size (1 GB).'}), 413

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No backup data provided.'}), 400

    serialized = json.dumps(data)
    if len(serialized.encode('utf-8')) > MAX_BACKUP_BYTES:
        return jsonify({'error': 'Backup exceeds maximum allowed size (1 GB).'}), 413
        
    db = get_db()
    user_id = g.user['id']
    
    # Check max backups
    cursor = db.execute('SELECT count(*) as count FROM backups WHERE user_id = ?', (user_id,))
    count = cursor.fetchone()['count']
    
    if count >= app.config['MAX_BACKUPS']:
        # Find oldest to delete
        num_to_delete = count - app.config['MAX_BACKUPS'] + 1
        oldest = db.execute(
            'SELECT id FROM backups WHERE user_id = ? ORDER BY timestamp ASC LIMIT ?',
            (user_id, num_to_delete)
        ).fetchall()
        
        for old in oldest:
            db.execute('DELETE FROM backups WHERE id = ?', (old['id'],))
            
    # Insert new backup
    db.execute(
        'INSERT INTO backups (user_id, data) VALUES (?, ?)',
        (user_id, serialized)
    )
    db.commit()
    
    return jsonify({'message': 'Backup created successfully.'}), 201

@app.route('/api/backups/<int:backup_id>', methods=['GET'])
@requires_auth
def get_backup(backup_id):
    db = get_db()
    backup = db.execute(
        'SELECT data FROM backups WHERE id = ? AND user_id = ?',
        (backup_id, g.user['id'])
    ).fetchone()
    
    if backup is None:
        return jsonify({'error': 'Backup not found.'}), 404
        
    return jsonify(json.loads(backup['data']))

@app.route('/api/backups/<int:backup_id>', methods=['DELETE'])
@requires_auth
def delete_backup(backup_id):
    db = get_db()
    cursor = db.execute(
        'DELETE FROM backups WHERE id = ? AND user_id = ?',
        (backup_id, g.user['id'])
    )
    db.commit()
    
    if cursor.rowcount == 0:
        return jsonify({'error': 'Backup not found.'}), 404
        
    return jsonify({'message': 'Backup deleted successfully.'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='minterestd Backup Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the server on')
    parser.add_argument('--max-backups', type=int, help='Maximum number of backups per user')
    args = parser.parse_args()
    
    if args.max_backups is not None:
        app.config['MAX_BACKUPS'] = args.max_backups
        
    print(f"Starting server with MAX_BACKUPS={app.config['MAX_BACKUPS']}")
    init_db()
    app.run(host='0.0.0.0', port=args.port, debug=False)
