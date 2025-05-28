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
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fileUploads";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

const conn = mongoose.connection;
let gfs;

conn.once("open", () => {
    gfs = new GridFSBucket(conn.db, { bucketName: "uploads" });
    console.log("✅ GridFS Initialized");
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
    const encryptedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    // This would normally come from your database
    const correctPasswordHash = process.env.ENCRYPTED_FOLDER_PASSWORD_HASH || 
        crypto.createHash('sha256').update("defaultpassword").digest('hex');
    
    if (encryptedPassword === correctPasswordHash) {
        // Generate a temporary access token (valid for 1 hour)
        const token = crypto.randomBytes(32).toString('hex');
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: "Incorrect password" });
    }
});


const checkEncryptedFolderAccess = (req, res, next) => {
    const folder = req.body.folder || req.query.folder;
    
    if (folder === "Encrypted Folder") {
        // In a real app, you'd verify a JWT or session token here
        const token = req.headers['x-access-token'];
        if (!token) {
            return res.status(403).send("Access denied");
        }
        // Token verification would go here
    }
    
    next();
};
// Upload Endpoint
app.post('/upload',checkEncryptedFolderAccess ,upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const readStream = fs.createReadStream(req.file.path);
    const writeStream = gfs.openUploadStream(req.file.filename, {
        metadata: { folder: req.body.folder || "root" }
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
    
    try {
        // Save folder metadata in a new collection (e.g., "folders")
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