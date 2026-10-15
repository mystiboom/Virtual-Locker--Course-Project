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
const path = require('path');

const app = express();
// Configure CORS for production - restrict to specific origins
// In development, you might want to allow more origins
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// Simple error logging to file
const logErrorToFile = (error) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${error.stack || error.message}\n`;
  fs.appendFile(path.join(__dirname, 'error.log'), logError, (err) => {
    if (err) {
      console.error('Failed to write to error log:', err);
    }
  });
};

// MongoDB Connection
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fileUploads";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
      console.error("❌ MongoDB Connection Error:", err);
      logErrorToFile(new Error(`MongoDB Connection Error: ${err}`));
    });

const conn = mongoose.connection;
let gfs;

conn.once("open", () => {
    try {
      gfs = new GridFSBucket(conn.db, { bucketName: "uploads" });
      console.log("✅ GridFS Initialized");
    } catch (err) {
      console.error("❌ GridFS Initialization Error:", err);
      logErrorToFile(new Error(`GridFS Initialization Error: ${err}`));
    }
});

conn.on("error", (err) => {
    console.error("❌ MongoDB Connection Error:", err);
    logErrorToFile(new Error(`MongoDB Connection Error: ${err}`));
});

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage });




const bcrypt = require('bcrypt');

app.post('/verify-folder-password', async (req, res) => {
    const { folderName, password } = req.body;

    if (folderName !== "Encrypted Folder") {
        return res.status(400).send("Not an encrypted folder");
    }

    // This would normally come from your database
    const correctPasswordHash = process.env.ENCRYPTED_FOLDER_PASSWORD_HASH ||
        await bcrypt.hash("defaultpassword", 10);

    // Compare password using bcrypt's constant-time comparison
    const isValid = await bcrypt.compare(password, correctPasswordHash);

    if (isValid) {
        // Generate a temporary access token with timestamp (valid for 1 hour)
        const timestamp = Date.now();
        const token = crypto.randomBytes(32).toString('hex') + '.' + timestamp;
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: "Incorrect password" });
    }
});


const checkEncryptedFolderAccess = (req, res, next) => {
    const folder = req.body.folder || req.query.folder;

    if (folder === "Encrypted Folder") {
        // Verify access token
        const token = req.headers['x-access-token'];
        if (!token) {
            return res.status(403).send("Access denied");
        }

        // Validate token format: hex.timestamp
        const tokenParts = token.split('.');
        if (tokenParts.length !== 2) {
            return res.status(403).send("Invalid access token format");
        }

        const tokenHex = tokenParts[0];
        const tokenTimestamp = parseInt(tokenParts[1], 10);

        // Check if token is a valid hex string
        const isValidHex = /^[0-9a-f]{64}$/.test(tokenHex);
        if (!isValidHex) {
            return res.status(403).send("Invalid access token");
        }

        // Check if timestamp is valid
        if (isNaN(tokenTimestamp) || tokenTimestamp <= 0) {
            return res.status(403).send("Invalid access token");
        }

        // Check if token has expired (valid for 1 hour)
        const ONE_HOUR = 60 * 60 * 1000;
        if (Date.now() - tokenTimestamp > ONE_HOUR) {
            return res.status(403).send("Access token expired");
        }
    }

    next();
};
// Upload Endpoint
app.post('/upload',checkEncryptedFolderAccess ,upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    // Validate folder parameter
    let folder = req.body.folder || "root";
    if (typeof folder !== 'string') {
        folder = "root";
    }

    // Limit folder name length
    if (folder.length > 100) {
        return res.status(400).send("Folder name too long");
    }

    // Prevent problematic characters in folder name
    if (/[<>:"/\\|?*\x00-\x1f]/.test(folder)) {
        return res.status(400).send("Folder name contains invalid characters");
    }

    const readStream = fs.createReadStream(req.file.path);
    const writeStream = gfs.openUploadStream(req.file.filename, {
        metadata: { folder: folder.trim() || "root" }
    });

    readStream.pipe(writeStream)
        .on("error", (error) => {
            console.error("Upload error:", error);
            res.status(500).send("Upload failed");
        })
        .on("finish", () => {
            fs.unlinkSync(req.file.path); // Delete temp file
            res.status(200).json({
                message: "File uploaded successfully",
                file: req.file
            });
        });
});

//  Add this endpoint
app.post("/create-folder", checkEncryptedFolderAccess, async (req, res) => {
    const { folderName, parentFolder } = req.body;

    // Input validation
    if (!folderName || typeof folderName !== 'string' || folderName.trim() === '') {
        return res.status(400).send("Folder name is required");
    }

    // Limit folder name length
    if (folderName.length > 100) {
        return res.status(400).send("Folder name too long");
    }

    // Prevent problematic characters
    if (/[<>:"/\\|?*\x00-\x1f]/.test(folderName)) {
        return res.status(400).send("Folder name contains invalid characters");
    }

    try {
        // Save folder metadata in a new collection (e.g., "folders")
        await conn.db.collection("folders").insertOne({
            name: folderName.trim(),
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
app.post('/zip-folder', async (req, res) => {
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
async function addFolderToArchive(archive, folderName, currentPath = '') {
    // Add files in current folder
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


// Add to server.js
app.put('/rename', async (req, res) => {
    const { oldName, newName, type } = req.body;

    // Input validation
    if (!oldName || typeof oldName !== 'string' || oldName.trim() === '') {
        return res.status(400).send("Old name is required");
    }

    if (!newName || typeof newName !== 'string' || newName.trim() === '') {
        return res.status(400).send("New name is required");
    }

    // Limit name length
    if (oldName.length > 100 || newName.length > 100) {
        return res.status(400).send("Name too long");
    }

    // Prevent problematic characters
    const invalidCharPattern = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidCharPattern.test(oldName) || invalidCharPattern.test(newName)) {
        return res.status(400).send("Name contains invalid characters");
    }

    // Prevent same name
    if (oldName.trim() === newName.trim()) {
        return res.status(400).send("New name must be different from old name");
    }

    try {
        if (type === 'file') {
            // Rename file in GridFS
            await conn.db.collection("uploads.files").updateOne(
                { filename: oldName.trim() },
                { $set: { filename: newName.trim() } }
            );
        } else if (type === 'folder') {
            // Rename folder and update all references
            await conn.db.collection("folders").updateOne(
                { name: oldName.trim() },
                { $set: { name: newName.trim() } }
            );

            // Update files in this folder
            await conn.db.collection("uploads.files").updateMany(
                { "metadata.folder": oldName.trim() },
                { $set: { "metadata.folder": newName.trim() } }
            );

            // Update subfolders' parent references
            await conn.db.collection("folders").updateMany(
                { parent: oldName.trim() },
                { $set: { parent: newName.trim() } }
            );
        }

        res.json({ success: true, message: "Renamed successfully" });
    } catch (error) {
        console.error("Rename error:", error);
        res.status(500).json({ success: false, message: "Failed to rename" });
    }
});





// Get Files Endpoint (keep existing implementation)
app.get("/files", async (req, res) => {
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
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const downloadStream = gfs.openDownloadStreamByName(filename);
    
    // Set headers for download
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);

    downloadStream.pipe(res)
        .on('error', () => res.status(404).send("File not found"));
});

// In server.js
app.delete('/delete/:name', async (req, res) => {
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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
