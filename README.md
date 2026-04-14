# ☁️ AWS Content Moderation Prototype

A local prototype/demo for a future AWS-powered image content moderation system.  
**No cloud services are connected** — this is a fully local simulation.

---

## 📁 Project Structure

```
CCFINAL/
├── src/
│   ├── Main.java           ← Entry point, starts the server
│   └── UploadServer.java   ← Simple HTTP server (serves files + /status endpoint)
├── web/
│   ├── index.html           ← Main page (upload form, preview, result area)
│   ├── style.css            ← Styling
│   └── script.js            ← Frontend logic (validation, preview, fake upload)
├── out/                     ← Compiled .class files (generated after compiling)
└── README.md                ← You are here
```

---

## 🚀 How to Run

### Prerequisites

- **Java JDK** (version 8 or newer) installed on your machine
- A terminal (Command Prompt, Terminal, or PowerShell)

### Step 1 — Compile

Open a terminal, navigate to the project folder, and compile:

```bash
cd /path/to/CCFINAL
javac -d out src/UploadServer.java src/Main.java
```

This creates compiled `.class` files inside the `out/` folder.

### Step 2 — Run the Server

```bash
java -cp out Main
```

You should see:

```
===========================================
  AWS Content Moderation Prototype Server
===========================================
  Server running on: http://localhost:8080
  Status endpoint:   http://localhost:8080/status
===========================================
```

### Step 3 — Open in Browser

Go to: **http://localhost:8080**

### Step 4 — Stop the Server

Press `Ctrl+C` in the terminal.

---

## 🧪 How It Works

1. User opens the page in a browser
2. Selects an image file (JPG, PNG, GIF, or WEBP — max 5 MB)
3. The image is previewed on-screen
4. User clicks **Upload Image**
5. The system validates the file locally (does **not** upload anywhere)
6. A prototype result is displayed showing the future AWS pipeline stages:
   - ✅ Image received
   - 📦 Ready for S3 upload
   - 🔍 Ready for moderation scan (Rekognition)
   - 👤 Ready for admin review workflow

---

## ⚙️ Tech Stack

| Layer    | Technology |
|----------|------------|
| Backend  | Java (built-in `com.sun.net.httpserver`) |
| Frontend | HTML, CSS, JavaScript |
| Database | None |
| Cloud    | None (prototype only) |

---

## ❌ What This Project Does NOT Include

- Real AWS connection (S3, Lambda, Rekognition, DynamoDB)
- Authentication or login
- Actual image uploads to any server or cloud
- Any external frameworks or libraries

---

## 📌 Notes

- The `/status` endpoint returns: `"AWS integration not connected yet. Prototype mode only."`
- If the Java server is not running, the page will still open (via a local file) but the status badge in the footer will show **Offline**
- The server uses port **8080** by default — if that port is taken, change the `PORT` constant in `UploadServer.java`
