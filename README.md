# ☁️ AWS Content Moderation Prototype

A local prototype/demo for a future AWS-powered image content moderation system.  
**No cloud services are connected** — this is a fully local simulation.

---

## 📁 Project Structure

```
aws-content-moderation-project/
│
├── lambda/
│   ├── get-upload-url.js          ← Generates presigned S3 upload URL
│   ├── process-image.js          ← Triggered by S3, runs Rekognition scan
│   └── get-moderation-result.js  ← Fetches result from DynamoDB
│
├── src/
│   ├── Main.java                 ← Entry point, starts local Java server
│   ├── UploadServer.java         ← Simple HTTP server (serves frontend + /status)
│   ├── Main.class                ← Compiled Java file
│   ├── UploadServer.class        ← Compiled server class
│   ├── UploadServer$StaticFileHandler.class
│   └── UploadServer$StatusHandler.class
│
├── out/
│   ├── Main.class
│   ├── UploadServer.class
│   ├── UploadServer$StaticFileHandler.class
│   └── UploadServer$StatusHandler.class
│   ← Compiled output directory
│
├── web/
│   ├── index.html                ← Main UI (upload form, preview, results)
│   ├── script.js                 ← Frontend logic (upload + polling)
│   └── style.css                 ← Styling
│
├── LICENSE
└── README.md
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
4. User clicks Upload Image
5. The frontend sends a request to API Gateway to get a presigned upload URL
6. The image is uploaded directly to Amazon S3 using that URL
7. Once uploaded:
      - S3 automatically triggers a Lambda function
      - The Lambda sends the image to Amazon Rekognition for moderation
8. Rekognition analyzes the image and returns moderation labels
9. The result is stored in DynamoDB
10. The frontend continuously polls the backend for results
11. Once available, the system displays:
      - Uploaded to S3
      - Scanned by Rekognition
      - Moderation result (APPROVED / FLAGGED / BLOCKED)
      - Detected moderation labels

---

## ⚙️ Tech Stack

| Layer       | Technology            |
| ----------- | --------------------- |
| Frontend    | HTML, CSS, JavaScript |
| Backend     | AWS Lambda (Node.js)  |
| API         | Amazon API Gateway    |
| Storage     | Amazon S3             |
| AI          | Amazon Rekognition    |
| Database    | Amazon DynamoDB       |
| Auth/Access | AWS IAM               |


---

## ❌ What This Project Does NOT Include

- User authentication or login system
- Role-based access control for admins
- Image deletion or lifecycle management
- Advanced moderation tuning (confidence thresholds not customized)
- Production-grade UI/UX

---

## 📌 Notes

- Images are uploaded directly to S3 using presigned URLs (no backend file handling)
- The moderation process is asynchronous, so the frontend uses polling to fetch results
- If no result is returned immediately, the system retries multiple times before showing an error
- API Gateway handles all client-to-backend communication
- IAM roles control permissions for:
  - S3 upload
  - Rekognition scan
  - DynamoDB read/write
