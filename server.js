require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { GridFSBucket } = require("mongodb");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require('crypto');
const algorithm = 'aes-256-cbc';
const archiver = require('archiver');

const app = express();
app.disable("x-powered-by");
// Same-origin deployment needs no CORS. Enable cross-origin access only for explicitly trusted origins.
if (process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map(v => v.trim()).filter(Boolean);
  app.use(cors({ origin: allowedOrigins }));
}
app.use(express.json({ limit: "1mb" }));
// Serve only the intended frontend files; do not expose server.js, .env, or project files.
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
for (const asset of ["dashboard.css", "dashboard.js", "styles.css"]) {
  app.get(`/${asset}`, (req, res) => res.sendFile(path.join(__dirname, asset)));
}

// MongoDB Connection
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

const conn = mongoose.connection;
let gfs;

conn.once("open", () => {
    gfs = new GridFSBucket(conn.db, { bucketName: "uploads" });
    console.log("✅ GridFS Initialized");
});

app.use((req, res, next) => {
  if (!conn.db || !gfs || conn.readyState !== 1) {
    return res.status(503).json({ error: "File storage is not ready. Please retry shortly." });
  }
  next();
});

// Multer uses an absolute temporary directory; files are removed after GridFS upload.
const uploadsDir = path.join(require("os").tmpdir(), "virtual-locker-uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}-${path.basename(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES) || 50 * 1024 * 1024 } });

// Short-lived, process-local tokens for encrypted-folder access.
const encryptedFolderTokens = new Map();
const TOKEN_TTL_MS = 60 * 60 * 1000;
const ENCRYPTED_FOLDER_NAME = "Encrypted Folder";

// Resolve whether a folder is inside the encrypted folder, including nested folders.
// Folder names are used as identifiers by the existing data model, so this follows
// the project's current architecture rather than introducing a schema migration.
async function isInsideEncryptedFolder(folderName) {
  if (typeof folderName !== "string" || !folderName || folderName === "root") return false;
  let current = folderName;
  const visited = new Set();
  while (current && current !== "root" && !visited.has(current)) {
    if (current === ENCRYPTED_FOLDER_NAME) return true;
    visited.add(current);
    const folderDoc = await conn.db.collection("folders").findOne({ name: current });
    if (!folderDoc) return false;
    current = folderDoc.parent;
  }
  return false;
}

async function encryptedFolderAccess(req, res, next) {
  try {
    const token = req.get("x-access-token");
    const expiresAt = token && encryptedFolderTokens.get(token);
    const validToken = Boolean(expiresAt && expiresAt > Date.now());
    if (token && !validToken) encryptedFolderTokens.delete(token);

    const folderTargets = [
      req.body?.folder,
      req.query?.folder,
      req.body?.parentFolder,
      req.body?.folderName,
    ].filter(value => typeof value === "string" && value.length > 0);

    let protectedTarget = false;
    for (const folderName of folderTargets) {
      if (await isInsideEncryptedFolder(folderName)) {
        protectedTarget = true;
        break;
      }
    }

    // File/folder operations can target an item by name rather than by folder path.
    const targetName = req.params?.name || req.params?.filename || req.body?.oldName;
    if (!protectedTarget && targetName) {
      const files = await conn.db.collection("uploads.files")
        .find({ filename: path.basename(targetName) }).toArray();
      for (const file of files) {
        if (await isInsideEncryptedFolder(file.metadata?.folder)) {
          protectedTarget = true;
          break;
        }
      }
      if (!protectedTarget) {
        const folderDocs = await conn.db.collection("folders").find({ name: targetName }).toArray();
        for (const folderDoc of folderDocs) {
          if (await isInsideEncryptedFolder(folderDoc.name) || await isInsideEncryptedFolder(folderDoc.parent)) {
            protectedTarget = true;
            break;
          }
        }
      }
    }

    if (protectedTarget && !validToken) {
      return res.status(403).json({ error: "Encrypted Folder access expired. Unlock it again." });
    }
    next();
  } catch (error) {
    console.error("Encrypted-folder access check failed:", error);
    res.status(500).json({ error: "Could not verify folder access." });
  }
}

async function addFolderToArchive(archive, folderName, currentPath = '') {
    // Add all files in current folder
    const files = await conn.db.collection("uploads.files")
        .find({ "metadata.folder": folderName })
        .toArray();

    for (const file of files) {
        const downloadStream = gfs.openDownloadStream(file._id);
        archive.append(downloadStream, { 
            name: path.join(currentPath, file.filename) 
        });
    }

    // Recursively add subfolders
    const subfolders = await conn.db.collection("folders")
        .find({ parent: folderName })
        .toArray();

    for (const subfolder of subfolders) {
        const folderPath = path.join(currentPath, subfolder.name);
        await addFolderToArchive(archive, subfolder.name, folderPath);
    }
}




app.post('/verify-folder-password', async (req, res) => {
    const { folderName, password } = req.body;
    
    if (folderName !== "Encrypted Folder") {
        return res.status(400).send("Not an encrypted folder");
    }
    
    // In a real app, you'd store hashed passwords in the database
    // For demo purposes, we'll use a simple approach
    if (typeof password !== "string" || !process.env.ENCRYPTED_FOLDER_PASSWORD_HASH) {
        return res.status(503).json({ success: false, message: "Encrypted-folder password is not configured." });
    }
    const encryptedPassword = crypto.createHash("sha256").update(password).digest("hex");
    const correctPasswordHash = process.env.ENCRYPTED_FOLDER_PASSWORD_HASH.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(correctPasswordHash)) {
        return res.status(503).json({ success: false, message: "Encrypted-folder password hash must be a 64-character SHA-256 hex digest." });
    }
    if (crypto.timingSafeEqual(Buffer.from(encryptedPassword), Buffer.from(correctPasswordHash))) {
        const token = crypto.randomBytes(32).toString("hex");
        encryptedFolderTokens.set(token, Date.now() + TOKEN_TTL_MS);
        res.json({ success: true, token, expiresIn: TOKEN_TTL_MS / 1000 });
    } else {
        res.status(401).json({ success: false, message: "Incorrect password" });
    }
});


// Upload Endpoint
app.post("/upload", encryptedFolderAccess, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const tempPath = req.file.path;
  try {
    const folder = typeof req.body.folder === "string" ? req.body.folder.trim() || "root" : "root";
    if (folder.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(folder)) {
      return res.status(400).json({ error: "Invalid folder name" });
    }
    const writeStream = gfs.openUploadStream(path.basename(req.file.originalname), {
      metadata: { folder }
    });
    await require("stream/promises").pipeline(fs.createReadStream(tempPath), writeStream);
    return res.status(201).json({ message: "File uploaded successfully", file: {
      filename: path.basename(req.file.originalname), size: req.file.size, metadata: { folder }
    }});
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Upload failed" });
  } finally {
    try { await fs.promises.unlink(tempPath); } catch (error) {
      if (error.code !== "ENOENT") console.error("Temporary upload cleanup failed:", error);
    }
  }
});

//  Add this endpoint
app.post("/create-folder", encryptedFolderAccess, async (req, res) => {
    const { folderName, parentFolder } = req.body;
    
    try {
        if (typeof folderName !== "string" || !folderName.trim() || folderName.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(folderName)) {
            return res.status(400).json({ error: "Invalid folder name" });
        }
        await conn.db.collection("folders").insertOne({
            name: folderName,
            parent: parentFolder || "root",
            type: "folder",
            created: new Date()
        });
        
        res.status(201).send("Folder created");
    } catch (error) {
        res.status(500).send("Failed to create folder");
    }
});


// ✅ ADD THIS (handles subfolders recursively + better error handling)
app.post('/zip-folder', encryptedFolderAccess, async (req, res) => {
    const { folderName } = req.body;
    const zipFileName = `${folderName}.zip`;
    const outputPath = path.join(__dirname, 'temp_zips', zipFileName); // Stores temp zip

    try {
        // Create temp directory if missing
        if (!fs.existsSync(path.join(__dirname, 'temp_zips'))) {
            fs.mkdirSync(path.join(__dirname, 'temp_zips'));
        }

        // Check if folder exists
        const folder = await conn.db.collection("folders").findOne({ name: folderName });
        if (!folder) {
            return res.status(404).json({ success: false, message: "Folder not found" });
        }

        // Create zip stream
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', async () => {
            try {
                // Upload zip to GridFS
                const readStream = fs.createReadStream(outputPath);
                const writeStream = gfs.openUploadStream(zipFileName, {
                    metadata: { 
                        folder: folder.parent || "root", 
                        isZip: true,
                        originalFolder: folderName 
                    }
                });

                readStream.pipe(writeStream)
                    .on('error', (err) => {
                        console.error("Upload error:", err);
                        fs.unlinkSync(outputPath); // Cleanup
                        res.status(500).json({ success: false, message: "Failed to store zip file" });
                    })
                    .on('finish', () => {
                        fs.unlinkSync(outputPath); // Cleanup
                        res.status(200).json({ 
                            success: true, 
                            zipFile: zipFileName,
                            message: "Folder zipped successfully with all contents" 
                        });
                    });
            } catch (error) {
                console.error("Post-zip error:", error);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                res.status(500).json({ success: false, message: "Post-zip processing failed" });
            }
        });

        archive.on('error', (err) => {
            console.error("Archive error:", err);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            res.status(500).json({ success: false, message: "Zipping failed" });
        });

        archive.pipe(output);

        // Recursively add all files/subfolders
        await addFolderToArchive(archive, folderName);

        archive.finalize();

    } catch (error) {
        console.error("Zipping error:", error);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        res.status(500).json({ success: false, message: "Server error during zipping" });
    }
});

// ✅ Helper function (must be included!)
// Add to server.js
app.put('/rename', encryptedFolderAccess, async (req, res) => {
    const { oldName, newName, type } = req.body;
    
    try {
        if (type === 'file') {
            // Rename file in GridFS
            await conn.db.collection("uploads.files").updateOne(
                { filename: oldName },
                { $set: { filename: newName } }
            );
        } else if (type === 'folder') {
            // Rename folder and update all references
            await conn.db.collection("folders").updateOne(
                { name: oldName },
                { $set: { name: newName } }
            );
            
            // Update files in this folder
            await conn.db.collection("uploads.files").updateMany(
                { "metadata.folder": oldName },
                { $set: { "metadata.folder": newName } }
            );
            
            // Update subfolders' parent references
            await conn.db.collection("folders").updateMany(
                { parent: oldName },
                { $set: { parent: newName } }
            );
        }
        
        res.json({ success: true, message: "Renamed successfully" });
    } catch (error) {
        console.error("Rename error:", error);
        res.status(500).json({ success: false, message: "Failed to rename" });
    }
});





// Get Files Endpoint (keep existing implementation)
app.get("/files", encryptedFolderAccess, async (req, res) => {
    const folder = req.query.folder || "root";
    try {
        const files = await conn.db.collection("uploads.files")
            .find({ "metadata.folder": folder })
            .toArray();

            // Fetch folders from the folders collection
        const folders = await conn.db.collection("folders")
        .find({ parent: folder })
        .toArray();
        res.json([...files, ...folders]);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch files" });
    }
});

// Download Endpoint
app.get('/download/:filename', encryptedFolderAccess, async (req, res) => {
    const filename = path.basename(req.params.filename);
    try {
      const file = await conn.db.collection("uploads.files").find({ filename }).sort({ uploadDate: -1 }).next();
      if (!file) return res.status(404).send("File not found");
      if (file.metadata?.folder === "Encrypted Folder") {
        const token = req.get("x-access-token");
        const expiresAt = token && encryptedFolderTokens.get(token);
        if (!expiresAt || expiresAt <= Date.now()) return res.status(403).send("Encrypted Folder access expired");
      }
      const downloadStream = gfs.openDownloadStream(file._id);
    
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${filename.replace(/[\"\r\n]/g, "")}"`);
      downloadStream.on("error", (error) => {
        console.error("Download error:", error);
        if (!res.headersSent) res.status(404).send("File not found"); else res.destroy(error);
      });
      downloadStream.pipe(res);
    } catch (error) {
      console.error("Download lookup error:", error);
      if (!res.headersSent) res.status(500).send("Download failed");
    }
});

// In server.js
app.delete('/delete/:name', encryptedFolderAccess, async (req, res) => {
    const name = req.params.name;
    
    try {
        // First try to delete as a file
        const file = await conn.db.collection("uploads.files").findOne({ filename: name });
        if (file) {
            await conn.db.collection("uploads.chunks").deleteMany({ files_id: file._id });
            await conn.db.collection("uploads.files").deleteOne({ _id: file._id });
            return res.status(200).json({ 
                success: true, 
                type: 'file',
                message: "File deleted successfully" 
            });
        }

        // Then try to delete as a folder
        const folder = await conn.db.collection("folders").findOne({ name: name });
        if (folder) {
            // Get counts of files and subfolders
            const fileCount = await conn.db.collection("uploads.files").countDocuments({ 
                "metadata.folder": name 
            });
            const folderCount = await conn.db.collection("folders").countDocuments({ 
                parent: name 
            });
            
            if (fileCount > 0 || folderCount > 0) {
                return res.status(400).json({ 
                    success: false,
                    type: 'folder',
                    isNotEmpty: true,
                    fileCount,
                    folderCount,
                    message: `Folder contains ${fileCount} file(s) and ${folderCount} subfolder(s)`
                });
            }
            
            await conn.db.collection("folders").deleteOne({ _id: folder._id });
            return res.status(200).json({ 
                success: true,
                type: 'folder',
                message: "Folder deleted successfully" 
            });
        }

        return res.status(404).json({ 
            success: false,
            message: "File or folder not found" 
        });
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ 
            success: false,
            message: "Server error during deletion" 
        });
    }
});

// Start Server
const PORT = Number(process.env.PORT) || 5000;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Virtual Locker listening on port ${PORT}`));
function shutdown(signal) {
  console.log(`${signal} received; shutting down...`);
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));