import os
import json
import sqlite3
import argparse
from datetime import datetime
from flask import Flask, request, jsonify, g
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
    return jsonify({
        'status': 'minterestd is running',
        'version': '1.0.0',
        'endpoints': ['/api/register', '/api/backups']
    })

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

@app.route('/api/backups', methods=['POST'])
@requires_auth
def create_backup():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No backup data provided.'}), 400
        
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
        (user_id, json.dumps(data))
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
