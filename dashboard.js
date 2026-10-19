document.addEventListener("DOMContentLoaded", function () {
    // DOM Elements
    const newBtn = document.getElementById("newBtn");
    const dropdown = document.getElementById("dropdown");
    const newFolder = document.getElementById("newFolder");
    const fileUpload = document.getElementById("fileUpload");
    const fileInput = document.getElementById("fileInput");
    const fileTableBody = document.getElementById("fileTableBody");
    const sortOptions = document.getElementById("sortOptions");
    const searchInput = document.getElementById("searchInput");
    const searchButton = document.querySelector(".search-container");
    const goUpBtn = document.getElementById("goUpBtn");

    // State Management
    const urlParams = new URLSearchParams(window.location.search);
    let currentFolder = urlParams.get("folder") || "root";
    let starredItems = JSON.parse(localStorage.getItem('starredItems')) || {};
    let isStarredView = false;

    // A URL/history entry must never unlock the encrypted folder by itself.
    // If the page is opened directly at that URL without a live session token,
    // normalize it back to the root dashboard.
    if (currentFolder === "Encrypted Folder" && !sessionStorage.getItem("encryptedFolderToken")) {
        currentFolder = "root";
        history.replaceState({ folder: "root" }, "", "?folder=root");
    }

    function clearEncryptedFolderAccess() {
        sessionStorage.removeItem("encryptedFolderToken");
    }

    async function apiFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        const token = sessionStorage.getItem("encryptedFolderToken");
        if (token) headers.set("x-access-token", token);
        return fetch(url, { ...options, headers });
    }

    // Handle browser Back/Forward. Leaving the encrypted folder locks it again;
    // Forward navigation to its old history entry cannot restore the token.
    window.addEventListener("popstate", () => {
        const params = new URLSearchParams(window.location.search);
        let targetFolder = params.get("folder") || "root";

        if (currentFolder === "Encrypted Folder" && targetFolder !== "Encrypted Folder") {
            clearEncryptedFolderAccess();
        }

        if (targetFolder === "Encrypted Folder" && !sessionStorage.getItem("encryptedFolderToken")) {
            targetFolder = "root";
            history.replaceState({ folder: "root" }, "", "?folder=root");
        }

        currentFolder = targetFolder;
        isStarredView = false;
        fetchFiles();
    });

    // Initialize
    ensureEncryptedFolder();
    fetchFiles();

    // Event Listeners
    newBtn.addEventListener("click", toggleDropdown);
    document.addEventListener("click", closeDropdown);
    newFolder.addEventListener("click", handleNewFolder);
    fileUpload.addEventListener("click", triggerFileUpload);
    fileInput.addEventListener("change", handleFileUpload);
    sortOptions.addEventListener("change", handleSortChange);
    searchInput.addEventListener("input", handleSearch);
    searchButton.addEventListener("click", handleSearch);
    goUpBtn.addEventListener("click", goToParentFolder);
    document.getElementById('homeButton').addEventListener('click', navigateToRoot);
    document.getElementById('starredButton').addEventListener('click', function() {
        if (!isStarredView) {
            toggleStarredView();
        }
    });
    // Functions
    function toggleDropdown(e) {
        e.stopPropagation();
        dropdown.classList.toggle("visible");
    }

    function closeDropdown(e) {
        if (!newBtn.contains(e.target)) {
            dropdown.classList.remove("visible");
        }
    }

    function toggleStarredView() {
        isStarredView = true;
        fetchFiles().then(() => {
            const allItems = document.querySelectorAll('.file-table-row');
            allItems.forEach(row => {
                const starBtn = row.querySelector('.star-btn');
                if (starBtn) {
                    const itemName = starBtn.dataset.name;
                    if (!starredItems[itemName]) {
                        row.style.display = 'none';
                    } else {
                        row.style.display = 'flex';
                        row.classList.add('starred-item');
                    }
                } else {
                    // Hide folders since they don't have star buttons
                    row.style.display = 'none';
                }
            });
        });
        
        // Update active state in sidebar
        document.querySelectorAll('.sidebar-nav li').forEach(item => {
            item.classList.remove('active');
        });
        document.getElementById('starredButton').classList.add('active');
    }
    
    function showStarredItems() {
        const allItems = document.querySelectorAll('.file-table-row');
        allItems.forEach(row => {
            const starBtn = row.querySelector('.star-btn');
            if (starBtn) {
                const itemName = starBtn.dataset.name;
                if (!starredItems[itemName]) {
                    row.style.display = 'none';
                } else {
                    row.style.display = 'flex';
                    row.classList.add('starred-item');
                }
            }
        });
    }
    
    function toggleStar(itemName) {
        starredItems[itemName] = !starredItems[itemName];
        localStorage.setItem('starredItems', JSON.stringify(starredItems));
    }
    
    


    function updateStarButton(itemName) {
        const starButtons = document.querySelectorAll(`.star-btn[data-name="${itemName}"]`);
        starButtons.forEach(btn => {
            btn.classList.toggle('active', starredItems[itemName]);
            const icon = btn.querySelector('i');
            icon.className = starredItems[itemName] ? 'fas fa-star' : 'far fa-star';
        });
    }




    function navigateToRoot() {
        isStarredView = false; // Ensure we're not in starred view
        // Explicitly leaving the encrypted folder locks it again.
        clearEncryptedFolderAccess();
        currentFolder = "root";
        history.pushState({ folder: currentFolder }, "", `?folder=${currentFolder}`);
        fetchFiles();
        
        // Update active state in sidebar
        document.querySelectorAll('.sidebar-nav li').forEach(item => {
            item.classList.remove('active');
        });
        document.getElementById('homeButton').classList.add('active');
    }

    function ensureEncryptedFolder() {
        if (!document.getElementById("encryptedFolderRow") && currentFolder === "root") {
            const encryptedRow = document.createElement("div");
            encryptedRow.className = "file-table-row encrypted-folder";
            encryptedRow.innerHTML = `
                <div class="file-table-cell name-cell">
                    <i class="fas fa-folder folder-icon"></i>
                    <span class="file-name">Encrypted Folder</span>
                </div>
                <div class="file-table-cell modified-cell">
                    <span class="file-modified">Locked <i class="fas fa-lock"></i></span>
                </div>
                <div class="file-table-cell action-cell">
                    <button class="access-btn">
                        <i class="fas fa-key"></i> Access
                    </button>
                </div>
            `;
            fileTableBody.prepend(encryptedRow);
            
            encryptedRow.querySelector(".access-btn").addEventListener("click", promptForPassword);
        }
    }

    function handleNewFolder() {
        const folderName = prompt("Enter folder name:");
        if (folderName) {
            createFolder(folderName);
        }
        dropdown.classList.remove("visible");
    }

    function triggerFileUpload() {
        fileInput.click();
        dropdown.classList.remove("visible");
    }

    function handleFileUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            files.forEach(file => uploadFile(file));
        }
    }

    function handleSortChange() {
        sortFiles(sortOptions.value);
    }

    function handleSearch() {
        const query = searchInput.value.trim().toLowerCase();
        filterFiles(query);
    }

    function goToParentFolder() {
        navigateToRoot();
        if (currentFolder !== "root") {
            currentFolder = "root";
            history.pushState({ folder: currentFolder }, "", `?folder=${currentFolder}`);
            fetchFiles();
        }
    }
    
    async function starFolderContents(folderName) {
    try {
        // Get all files and subfolders in this folder
        const response = await apiFetch(`/files?folder=${encodeURIComponent(folderName)}`);
        const items = await response.json();
        
        for (const item of items) {
            starredItems[item.filename || item.name] = true;
            
            // If it's a folder, recursively star its contents
            if (item.type === 'folder') {
                await starFolderContents(item.name);
            }
        }
        
        localStorage.setItem('starredItems', JSON.stringify(starredItems));
    } catch (error) {
        console.error("Error starring folder contents:", error);
    }
}



async function renameItem(oldName, isFolder) {
    const newName = prompt(`Enter new name for ${isFolder ? 'folder' : 'file'}:`, oldName);
    if (!newName || newName === oldName) return;

    try {
        const response = await apiFetch("/rename", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                oldName,
                newName,
                type: isFolder ? 'folder' : 'file'
            }),
        });

        const result = await response.json();

        if (result.success) {
            // Update the starred items if this item was starred
            if (starredItems[oldName]) {
                starredItems[newName] = true;
                delete starredItems[oldName];
                localStorage.setItem('starredItems', JSON.stringify(starredItems));
            }

            // Refresh the file list
            fetchFiles();
        } else {
            alert(`Failed to rename: ${result.message}`);
        }
    } catch (error) {
        console.error("Rename error:", error);
        alert("Failed to rename. Please try again.");
    }
}

    // File Operations
    async function uploadFile(file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", currentFolder);

        try {
            const response = await apiFetch("/upload", {
                method: "POST",
                body: formData,
            });

            if (response.ok) {
                fetchFiles();
            } else {
                console.error("Upload failed");
            }
        } catch (error) {
            console.error("Error uploading file:", error);
        }
    }

    async function createFolder(folderName) {
        try {
            const response = await apiFetch("/create-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    folderName,
                    parentFolder: currentFolder
                }),
            });

            if (response.ok) {
                fetchFiles();
            } else {
                console.error("Failed to create folder");
            }
        } catch (error) {
            console.error("Error creating folder:", error);
        }
    }

    async function fetchFiles() {
        try {
            // Show loading state
            fileTableBody.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading files...</div>';
            
            const response = await apiFetch(`/files?folder=${currentFolder}`);
            
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            
            const data = await response.json();
            
            // Clear existing content
            fileTableBody.innerHTML = '';
            
            // Handle encrypted folder for root directory
            if (currentFolder === 'root' && !isStarredView) {
                const encryptedRow = document.createElement('div');
                encryptedRow.className = 'file-table-row encrypted-folder';
                encryptedRow.innerHTML = `
                    <div class="file-table-cell name-cell">
                        <i class="fas fa-folder folder-icon"></i>
                        <span class="file-name">Encrypted Folder</span>
                    </div>
                    <div class="file-table-cell modified-cell">
                        <span class="file-modified">Locked <i class="fas fa-lock"></i></span>
                    </div>
                    <div class="file-table-cell action-cell">
                        <button class="access-btn">
                            <i class="fas fa-key"></i> Access
                        </button>
                    </div>
                `;
                encryptedRow.querySelector('.access-btn').addEventListener('click', promptForPassword);
                fileTableBody.appendChild(encryptedRow);
            }
            
            // Handle actual files/folders
            if (data.length === 0 && currentFolder !== 'root') {
                fileTableBody.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-folder-open"></i>
                        <p>This folder is empty</p>
                    </div>
                `;
            } else {
                data.forEach(item => {
                    // Only add items that are either:
                    // 1. Not in starred view, or
                    // 2. In starred view and actually starred
                    if (!isStarredView || starredItems[item.filename || item.name]) {
                        addRow(item, item.type === 'folder');
                    }
                });
            }
            
    
        } catch (error) {
            console.error('Error fetching files:', error);
            fileTableBody.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Failed to load files. <button onclick="fetchFiles()">Retry</button></p>
                    <p class="error-detail">${error.message}</p>
                </div>
            `;
        }
    }

    async function downloadFile(filename) {
        try {
            const response = await apiFetch(`/download/${encodeURIComponent(filename)}`);
            if (!response.ok) throw new Error(`Download failed (${response.status})`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            console.error("Error downloading file:", error);
            alert("Failed to download file");
        }
    }

    function addRow(item, isFolder = false) {
        const name = item.filename || item.name;
        const modifiedDate = isFolder 
            ? new Date(item.created).toLocaleDateString() 
            : new Date(item.uploadDate).toLocaleDateString();
        
        // Skip for encrypted folder
        if (name === "Encrypted Folder") {
            return;
        }
    
        const row = document.createElement("div");
        row.className = "file-table-row";
        row.innerHTML = `
            <div class="file-table-cell name-cell">
                ${!isFolder ? `
                <button class="star-btn ${starredItems[name] ? 'active' : ''}" data-name="${name}">
                    <i class="${starredItems[name] ? 'fas' : 'far'} fa-star"></i>
                </button>
                ` : ''}
                <i class="fas ${isFolder ? 'fa-folder folder-icon' : 'fa-file-alt file-icon'}"></i>
                <span class="file-name">${name}</span>
            </div>
            <div class="file-table-cell modified-cell">
                <span class="file-modified">${modifiedDate}</span>
            </div>
            <div class="file-table-cell action-cell">
                <button class="rename-btn" data-filename="${name}" data-type="${isFolder ? 'folder' : 'file'}">
                    <i class="fas fa-pencil-alt"></i> Rename
                </button>
                ${!isFolder ? `
                <button class="download-btn" data-filename="${name}">
                    <i class="fas fa-download"></i> Download
                </button>
                ` : ''}
                ${isFolder ? `
                <button class="zip-btn" data-folder="${name}">
                    <i class="fas fa-file-archive"></i> Zip
                </button>
                ` : ''}
                <button class="delete-btn" data-filename="${name}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
    
        fileTableBody.appendChild(row);
    
        row.querySelector(".rename-btn").addEventListener("click", function(e) {
            e.stopPropagation();
            renameItem(name, isFolder);
        });
        
        // Only add star button event listener for files
        if (!isFolder) {
            row.querySelector('.star-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemName = e.currentTarget.dataset.name;
                toggleStar(itemName);
                updateStarButton(itemName);

            });
        }
    
        // Add click handler for folder navigation
        if (isFolder) {
            const nameCell = row.querySelector(".name-cell");
            nameCell.style.cursor = "pointer";
            nameCell.addEventListener("click", function() {
                if (name === "Encrypted Folder") {
                    if (!sessionStorage.getItem('encryptedFolderToken')) {
                        promptForPassword();
                        return;
                    }
                }
                currentFolder = name;
                history.pushState({ folder: currentFolder }, "", `?folder=${currentFolder}`);
                fetchFiles();
            });

            const zipBtn = row.querySelector(".zip-btn");
            if (zipBtn) {
                zipBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    console.log("Zip button clicked for:", name); // Debug
                    zipFolder(name);
                });
            }

        } else {
            // Add click handler for file download
            const nameCell = row.querySelector(".name-cell");
            nameCell.style.cursor = "pointer";
            nameCell.addEventListener("click", function() {
                downloadFile(name);
            });
        }
    
        // Add download handler (for the download button)
        const downloadBtn = row.querySelector(".download-btn");
        if (downloadBtn) {
            downloadBtn.addEventListener("click", function(e) {
                e.stopPropagation();
                downloadFile(name);
            });
        }
    
        // Add delete handler
        row.querySelector(".delete-btn").addEventListener("click", function(e) {
            e.stopPropagation();
            deleteFile(name);
        });
    }

    async function deleteFile(filename) {
        if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    
        try {
            const response = await apiFetch(`/delete/${encodeURIComponent(filename)}`, {
                method: "DELETE",
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                if (result.isNotEmpty) {
                    // Show detailed message for non-empty folders
                    const shouldForceDelete = confirm(
                        `${result.message}\n\nDo you want to delete everything inside this folder?`
                    );
                    
                    if (shouldForceDelete) {
                        await deleteFolderContents(filename);
                        await deleteFile(filename); // Retry deletion
                    }
                    return;
                }
                throw new Error(result.message || "Deletion failed");
            }
    
            // Remove the item from UI
            const rows = document.querySelectorAll('.file-table-row');
            for (const row of rows) {
                const nameElement = row.querySelector('.file-name');
                if (nameElement && nameElement.textContent === filename) {
                    row.remove();
                    break;
                }
            }
    
            // Show empty state if needed
            updateEmptyState();
        } catch (error) {
            console.error("Delete error:", error);
            alert(`Failed to delete: ${error.message}`);
        }
    }
    
    async function deleteFolderContents(folderName) {
        try {
            // First delete all files in the folder
            const filesResponse = await apiFetch(`/files?folder=${encodeURIComponent(folderName)}`);
            const items = await filesResponse.json();
            
            // Delete all files and subfolders recursively
            for (const item of items) {
                if (item.type === 'folder') {
                    await deleteFolderContents(item.name);
                }
                await apiFetch(`/delete/${encodeURIComponent(item.filename || item.name)}`, {
                    method: "DELETE",
                });
            }
        } catch (error) {
            console.error("Error deleting folder contents:", error);
            throw error;
        }
    }
    
    function updateEmptyState() {
        const remainingFiles = fileTableBody.querySelectorAll('.file-table-row:not(.encrypted-folder)');
        if (remainingFiles.length === 0) {
            fileTableBody.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>This folder is empty</p>
                </div>
            `;
            if (currentFolder === "root") {
                ensureEncryptedFolder();
            }
        }
    }
    async function promptForPassword() {
        const password = prompt("Enter password to access Encrypted Folder:");
        if (!password) return;
        
        try {
            const response = await apiFetch("/verify-folder-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    folderName: "Encrypted Folder",
                    password: password
                }),
            });
            
            const result = await response.json();
            
            if (result.success) {
                sessionStorage.setItem('encryptedFolderToken', result.token);
                currentFolder = "Encrypted Folder";
                history.pushState({ folder: currentFolder }, "", `?folder=${currentFolder}`);
                fetchFiles();
            } else {
                alert("Incorrect password!");
            }
        } catch (error) {
            console.error("Error verifying password:", error);
            alert("Error verifying password");
        }
    }

    async function zipFolder(folderName) {
        console.log("Zip button clicked - Folder:", folderName); 

        try {
            const response = await apiFetch('/zip-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderName })
            });
    
            const result = await response.json();
    
            if (!response.ok || !result.success) {
                throw new Error(result.message || "Zipping failed");
            }
    
            alert(result.message);
            fetchFiles(); // Refresh the file list
        } catch (error) {
            console.error("Zipping error:", error);
            alert(`Failed to zip folder: ${error.message}`);
        }
    }
    
    

    function filterFiles(query) {
        const rows = fileTableBody.querySelectorAll(".file-table-row:not(.encrypted-folder)");
        let found = false;

        rows.forEach(row => {
            const fileName = row.querySelector(".file-name").textContent.toLowerCase();
            if (fileName.includes(query)) {
                row.style.display = "flex";
                found = true;
            } else {
                row.style.display = "none";
            }
        });

        // Show empty state if no matches
        const emptyState = fileTableBody.querySelector(".empty-state");
        if (!found && !emptyState) {
            fileTableBody.innerHTML += `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No files match your search</p>
                </div>
            `;
        } else if (found && emptyState) {
            emptyState.remove();
        }
    }

    function sortFiles(criteria) {
        const rows = Array.from(fileTableBody.querySelectorAll(".file-table-row:not(.encrypted-folder)"));
        const encryptedRow = fileTableBody.querySelector(".encrypted-folder");

        let sortedRows;
        if (criteria === "nameAsc") {
            sortedRows = rows.sort((a, b) => 
                a.querySelector(".file-name").textContent.localeCompare(b.querySelector(".file-name").textContent)
            );
        } else if (criteria === "nameDesc") {
            sortedRows = rows.sort((a, b) => 
                b.querySelector(".file-name").textContent.localeCompare(a.querySelector(".file-name").textContent)
            );
        } else if (criteria === "dateAsc") {
            sortedRows = rows.sort((a, b) => 
                new Date(a.querySelector(".file-modified").textContent) - new Date(b.querySelector(".file-modified").textContent)
            );
        } else if (criteria === "dateDesc") {
            sortedRows = rows.sort((a, b) => 
                new Date(b.querySelector(".file-modified").textContent) - new Date(a.querySelector(".file-modified").textContent)
            );
        }

        fileTableBody.innerHTML = "";
        if (encryptedRow) fileTableBody.appendChild(encryptedRow);
        sortedRows.forEach(row => fileTableBody.appendChild(row));
    }

    // Handle browser back/forward
    window.addEventListener("popstate", function (e) {
        const folder = e.state?.folder || "root";
        currentFolder = folder;
        fetchFiles();
    });
});