# Virtual Locker

A full-stack web application for securely managing digital files and folders through a browser-based dashboard. Virtual Locker uses an Express backend, MongoDB/GridFS storage, and a JavaScript frontend with support for uploads, downloads, folder management, encrypted-folder access, searching, sorting, starring, renaming, deletion, and ZIP downloads.

## Overview

Virtual Locker is a course project that provides a cloud-storage-style interface for organizing digital files. The Express server serves the dashboard and static assets, exposes the file-management API, and stores uploaded files in MongoDB GridFS.

The application is configured for both local development and deployment:

- The dashboard is served from the Express application at `/`.
- Frontend assets are served through explicit routes rather than exposing the whole project directory.
- API requests use same-origin relative URLs, so no localhost URL is required in production.
- MongoDB/GridFS is used for persistent file storage.
- Sensitive configuration is loaded from environment variables.

## Features

- Upload one or more files to the current folder
- Create nested folders
- Browse files and folders from the dashboard
- Download files
- Rename files and folders
- Delete files and folders, including recursive folder-content deletion
- Create ZIP archives of folders and their nested contents
- Search files by name
- Sort items by name or modification date
- Star files and view starred items
- Password-protected **Encrypted Folder**
- Short-lived access tokens for encrypted-folder sessions
- Upload-size limits and input validation
- Error logging and graceful shutdown handling
- Automated frontend and backend tests with Jest

## Tech Stack

- **JavaScript** — frontend, backend, and tests
- **Node.js** — runtime
- **Express** — web server and API routes
- **MongoDB / Mongoose** — database connection and data access
- **MongoDB GridFS** — file storage
- **Multer** — temporary upload handling
- **Archiver** — folder ZIP creation
- **Jest, Supertest, and Testing Library** — automated tests
- **HTML and CSS** — dashboard structure and styling

## Project Structure

```text
Virtual-Locker--Course-Project/
├── __tests__/             # Frontend and backend tests
├── dashboard.html         # Main dashboard page
├── dashboard.js           # Dashboard state and user interactions
├── dashboard.css          # Dashboard-specific styles
├── styles.css             # Shared styles
├── server.js              # Express server and API endpoints
├── package.json           # Dependencies and npm scripts
├── jest.config.js         # Jest configuration
├── jest.setup.js          # Jest setup
├── .env                   # Local environment variables; do not commit
└── README.md
```

## Requirements

- Node.js 18 or newer recommended
- npm
- A MongoDB database accessible by the application

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/mystiboom/Virtual-Locker--Course-Project.git
cd Virtual-Locker--Course-Project
npm install
```

## Environment Configuration

Create a `.env` file in the project root. The `.env` file is ignored by Git and must not contain values that are committed to the repository.

Example configuration:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/virtual-locker
ENCRYPTED_FOLDER_PASSWORD_HASH=<64-character SHA-256 hash>
MAX_UPLOAD_BYTES=52428800
ALLOWED_ORIGINS=https://your-frontend.example.com
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port used by Express. Defaults to `5000`. |
| `MONGO_URI` | Yes | MongoDB connection string used by Mongoose and GridFS. |
| `ENCRYPTED_FOLDER_PASSWORD_HASH` | Yes for encrypted-folder access | SHA-256 hexadecimal hash of the encrypted-folder password. |
| `MAX_UPLOAD_BYTES` | No | Maximum upload size in bytes. Defaults to `52428800` (50 MiB). |
| `ALLOWED_ORIGINS` | No | Comma-separated list of trusted origins for cross-origin requests. Leave unset for same-origin deployment. |

To generate a SHA-256 password hash, use a trusted local tool. For example:

```bash
printf '%s' 'your-password' | shasum -a 256
```

Only store the resulting 64-character hexadecimal digest in `ENCRYPTED_FOLDER_PASSWORD_HASH`, never the plain-text password.

## Running Locally

Start the server with:

```bash
npm start
```

Then open:

```text
http://localhost:5000
```

The port can be changed with the `PORT` environment variable.

## Deployment

The application is designed to run as a single Express service that serves both the frontend and backend:

1. Configure the deployment platform to run `npm install` during the build/install step.
2. Set the required environment variables, especially `MONGO_URI` and `ENCRYPTED_FOLDER_PASSWORD_HASH`.
3. Start the service with `npm start`.
4. Ensure the platform provides the port through the `PORT` environment variable, when required.
5. Use a persistent MongoDB deployment because uploaded files are stored in GridFS.
6. Keep `ALLOWED_ORIGINS` unset when the frontend and API are served from the same origin. Configure it only when cross-origin access is intentionally required.

The server listens on `0.0.0.0`, serves `dashboard.html` at the root route, and exposes only the intended frontend assets. Do not expose the repository directory as a public static directory.

## Available API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serves the dashboard. |
| `POST` | `/verify-folder-password` | Verifies the encrypted-folder password and returns a short-lived access token. |
| `POST` | `/upload` | Uploads a file to the selected folder. |
| `POST` | `/create-folder` | Creates a folder or nested folder. |
| `POST` | `/zip-folder` | Creates a ZIP archive containing a folder and its contents. |
| `PUT` | `/rename` | Renames a file or folder. |
| `GET` | `/files` | Lists files and folders in a selected folder. |
| `GET` | `/download/:filename` | Downloads a file. |
| `DELETE` | `/delete/:name` | Deletes a file or an empty folder. |

Operations involving the encrypted folder require the temporary `x-access-token` returned by `/verify-folder-password`.

## Testing

Run the complete test suite:

```bash
npm test
```

Run frontend tests only:

```bash
npm run test:frontend
```

Run backend tests only:

```bash
npm run test:backend
```

Run tests in watch mode:

```bash
npm run test:watch
```

Generate a coverage report:

```bash
npm run test:coverage
```

## Security Notes

- Never commit `.env`, passwords, database credentials, or access tokens.
- Use a strong encrypted-folder password and store only its SHA-256 hash.
- Configure `ALLOWED_ORIGINS` with explicit trusted origins when cross-origin requests are needed.
- Keep MongoDB credentials private and restrict database network access.
- Uploaded files are temporarily written to an operating-system temporary directory and removed after they are stored in GridFS.
- Encrypted-folder access tokens are process-local and expire after one hour.
- The application validates folder names and limits upload sizes.

## Development Workflow

1. Create a feature branch.
2. Update the frontend or backend code.
3. Run the relevant tests and the full test suite.
4. Verify environment variables locally without committing `.env`.
5. Open a pull request with a description of the changes.

## License

No license file is currently included. Add a license before distributing or reusing this project publicly.
