# Privacy Policy

**Minterest** is a local-first application. This means that your data belongs to you and stays on your device.

## 1. No Server-Side Storage
Minterest does not use a central database or cloud storage. When you add topics, images, or notes, they are stored directly in your browser using **IndexedDB**. No information is ever uploaded to a remote server.

## 2. Remote Hosting vs. Local Hosting
Because the application is entirely client-side (HTML, CSS, and JavaScript), you can safely use it wherever it is hosted. The host only serves the static code files; they have no access to the data stored in your browser's private storage.

## 3. Self-Hosting
If you prefer total control, you are encouraged to:
1. Download or clone the repository from GitHub.
2. Open `index.html` directly in your browser or host it on your own hardware.

## 4. P2P Syncing
The optional Sync feature uses **PeerJS** to facilitate a direct peer-to-peer connection between your devices. While a signaling server is used to help the devices find each other (handshaking), your actual data is transferred directly between devices and is not stored by the signaling service.

## 5. Third-Party CDNs
The application loads a few essential libraries from `esm.sh`. These services may see your IP address as part of the standard web request to fetch the library code, but they do not receive any of your application data.
