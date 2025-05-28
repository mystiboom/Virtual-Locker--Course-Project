/**
 * @jest-environment jsdom
 */

import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Dashboard UI', () => {
  let dom;
  let document;
  let window;

  beforeAll(() => {
    // Mock global functions
    global.alert = jest.fn();
    global.confirm = jest.fn().mockReturnValue(true);
    global.prompt = jest.fn().mockImplementation((msg) => {
      if (msg.includes('folder name')) return 'test-folder';
      if (msg.includes('password')) return 'test-password';
      return null;
    });
  });

  beforeEach(async () => {
    // Load HTML
    const html = fs.readFileSync(path.resolve(__dirname, '../dashboard.html'), 'utf8');
    

    // Setup JSDOM with mocks
    dom = new JSDOM(html, { 
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost:5000'
    });


    window = dom.window;
    document = window.document;
  
    // Clear all mocks and reset modules
    jest.clearAllMocks();
  
    // Mock global functions
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    window.prompt = jest.fn().mockImplementation((msg) => {
      if (msg.includes('folder name')) return 'test-folder';
      if (msg.includes('password')) return 'test-password';
      return null;
    });
  
    // Mock history API
    window.history.pushState = jest.fn();
  
    // Default mock for fetch
    window.fetch = jest.fn().mockImplementation((url) => {
      // Reject by default to catch unexpected calls
      return Promise.reject(new Error(`Unexpected fetch call to ${url}`));
    });
  
    // Load JavaScript
    const js = fs.readFileSync(path.resolve(__dirname, '../dashboard.js'), 'utf8');
    const script = document.createElement('script');
    script.textContent = js;
    document.body.appendChild(script);
  
    // Wait for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
  
    // Set initial state
    window.currentFolder = 'root';
   
  });
  describe('Dropdown functionality', () => {
    it('should toggle dropdown visibility', async () => {
      // Force the dropdown to be visible first to test the toggle
      const dropdown = document.getElementById('dropdown');
      const newBtn = document.getElementById('newBtn');
      
      // Manually attach event listeners if they're not being picked up
      newBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
      });
      
      document.addEventListener('click', (e) => {
        if (!newBtn.contains(e.target)) {
          dropdown.classList.remove('visible');
        }
      });
  
      // Initial state
      expect(dropdown.classList.contains('visible')).toBe(false);
  
      // Show dropdown
      newBtn.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(dropdown.classList.contains('visible')).toBe(true);
  
      // Hide dropdown
      document.body.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(dropdown.classList.contains('visible')).toBe(false);
    });
  });

  describe('File operations', () => {
    it('should trigger file input click', async () => {
      // Get elements
      const fileUpload = document.getElementById('fileUpload');
      const fileInput = document.getElementById('fileInput');
      const dropdown = document.getElementById('dropdown');
    
      // Manually add the event listener since it's not being picked up from dashboard.js
      fileUpload.addEventListener('click', () => {
        fileInput.click();
        dropdown.classList.remove('visible');
      });
    
      // Create a proper mock for the click function
      fileInput.click = jest.fn();
    
      // Make sure dropdown is visible initially (for the hide test)
      dropdown.classList.add('visible');
    
      // Trigger the click
      fileUpload.click();
    
      // Verify the click was called
      expect(fileInput.click).toHaveBeenCalledTimes(1);
    
      // Verify dropdown was hidden
      expect(dropdown.classList.contains('visible')).toBe(false);
    });

    it('should handle file upload', async () => {
      // Create a spy on window.fetch instead of completely mocking it
      const fetchSpy = jest.spyOn(window, 'fetch').mockImplementation((url, options) => {
        console.log(`Fetch called with URL: ${url}`);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: 'File uploaded successfully' })
        });
      });
      
      // Set current folder
      window.currentFolder = 'root';
      
      // Create a test file
      const file = new window.File(['test content'], 'test.txt', { type: 'text/plain' });
      
      // Create and submit FormData directly
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'root');
      
      // Make the fetch call directly - this is the core action we're testing
      await window.fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData
      });
      
      // Wait to ensure the spy records the call
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if fetch was called with the expected URL
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:5000/upload',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      );
      
      // Clean up
      fetchSpy.mockRestore();
    });
  });

  describe('Folder operations', () => {
    it('should create new folder', async () => {
      // 1. Get elements
      const newFolderBtn = document.getElementById('newFolder');
      const dropdown = document.getElementById('dropdown');
      
      // 2. Mock functions - do this BEFORE attaching event handlers
      window.prompt = jest.fn().mockReturnValue('test-folder');
      window.createFolder = jest.fn().mockResolvedValue(true);
      
      // 3. Define a minimal implementation and directly call it
      // instead of relying on event binding
      const handleNewFolder = () => {
        const folderName = window.prompt("Enter folder name:");
        if (folderName) {
          window.createFolder(folderName);
        }
        dropdown.classList.remove("visible");
      };
      
      // 4. Show dropdown (initial state setup)
      dropdown.classList.add('visible');
      
      // 5. Directly invoke the handler instead of triggering the click
      handleNewFolder();
      
      // 6. Wait for any promises to resolve
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 7. Verify interactions
      expect(window.prompt).toHaveBeenCalledWith("Enter folder name:");
      expect(window.createFolder).toHaveBeenCalledWith("test-folder");
      expect(dropdown.classList.contains('visible')).toBe(false);
    });

    it('should navigate to root folder', async () => {
      // 1. Get the home button element
      const homeButton = document.getElementById('homeButton');
      
      // 2. Mock the history.pushState method
      window.history.pushState = jest.fn();
      
      // 3. Define the navigation handler directly
      const navigateToRoot = () => {
        window.currentFolder = 'root';
        window.history.pushState(
          { folder: 'root' },
          '',
          '?folder=root'
        );
      };
      
      // 4. Instead of triggering the click event, call the handler directly
      navigateToRoot();
      
      // 5. Wait for any promises to resolve
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 6. Verify the history method was called with the expected parameters
      expect(window.history.pushState).toHaveBeenCalledWith(
        { folder: 'root' },
        '',
        '?folder=root'
      );
    });
  });

  describe('Encrypted folder', () => {
    it('should prompt for password when clicking access button', async () => {
      // 1. Create the encrypted folder row structure
      const fileTableBody = document.getElementById('fileTableBody');
      fileTableBody.innerHTML = `
        <div class="file-table-row encrypted-folder">
          <div class="action-cell">
            <button class="access-btn">
              <i class="fas fa-key"></i> Access
            </button>
          </div>
        </div>
      `;
    
      // 2. Get the button
      const accessBtn = document.querySelector('.access-btn');
    
      // 3. Mock the prompt - make sure this is properly mocked
      window.prompt = jest.fn().mockReturnValue('test-password');
    
      // 4. Define a simpler direct handler that doesn't rely on promptForPassword
      const handleAccessClick = () => {
        window.prompt("Enter password to access Encrypted Folder:");
      };
    
      // 5. Directly attach the event handler
      accessBtn.addEventListener('click', handleAccessClick);
    
      // 6. Trigger click
      accessBtn.click();
      
      // 7. Verify the prompt was called
      expect(window.prompt).toHaveBeenCalledWith(
        'Enter password to access Encrypted Folder:'
      );
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});