# NOC-CSOC

---

### 🔧 Clone and Set Up Project
```bash
git clone https://github.com/elif-absrd/NOC.git
cd NOC
```

---

### 📦 Install Node.js and NPM  
(Download manually from https://nodejs.org)

Check installation:
```bash
node -v
npm -v
```

---

### ⚙️ Install FFmpeg (Windows)
```powershell
Set-ExecutionPolicy Bypass -Scope CurrentUser -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
choco install ffmpeg
```

---

### 🔍 Install and Start Elasticsearch
(Download from https://www.elastic.co/downloads/elasticsearch)

```bash
bin/elasticsearch.bat
```

Verify:
```bash
curl -X GET "localhost:9200"
```

---

### 📊 Install and Start Kibana
(Download from https://www.elastic.co/downloads/kibana)

```bash
bin/kibana.bat
```

Access: [http://localhost:5601](http://localhost:5601)

---

### 📈 Install and Start Grafana
(Download from https://grafana.com/grafana/download)

```bash
grafana-server.exe
```

Access: [http://localhost:3000](http://localhost:3000)

---

### 📁 Install Project Dependencies
```bash
cd noc_csoc
npm init -y
npm install express node-media-server @elastic/elasticsearch jwt-simple bcrypt dotenv cors child_process
```

---

### 🔑 Create `.env` File
```env
JWT_SECRET=your-secret-key-here
```

---

### 🛠 Update FFmpeg Path in `server.js`
```js
ffmpeg: 'C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin\\ffmpeg.exe'
```

---

### 🔥 Run the Project

Start backend:
```bash
cd backend
node server.js
```

Start FFmpeg stream:
```powershell
powershell -File ../stream.ps1
```

Open client dashboard (VS Code Live Server):
```bash
http://localhost:5500/frontend/client.html
```

Stream URL:
```bash
http://localhost:8000/live/stream/index.m3u8
```

---

### 📊 Configure Kibana
1. Open: [http://localhost:5601](http://localhost:5601)  
2. Add Index Pattern: `streaming_logs_v3`  
3. Time field: `@timestamp`

---

### 📈 Configure Grafana
1. Open: [http://localhost:3000](http://localhost:3000)  
2. Add Elasticsearch Data Source  
   - URL: `http://localhost:9200`  
   - Index: `streaming_logs_v3`  
   - Time Field: `@timestamp`

---

### 🔐 Login Credentials

| Role   | Username | Password   |
|--------|----------|------------|
| Admin  | admin    | admin123   |
| Client | client1  | client123  |

---

### 🧪 Troubleshooting Commands

Check `.ts` files are being generated:
```bash
dir backend/media/live/stream
```

Check backend is running on port 8000:
```bash
curl http://localhost:8000
```

---

Let me know if you'd like this exported as a `.md` file or pushed directly to a GitHub repo!
