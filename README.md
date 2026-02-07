# MediCall AWS (Chime SDK Implementation)

This project is a React + Express implementation of a video consultation app using the **Amazon Chime SDK**.

## Prerequisites

1. **AWS Account**: You need an AWS account.
2. **IAM User**: Create an IAM user with `AmazonChimeFullAccess` permissions.
3. **AWS Credentials**: Obtain an Access Key ID and Secret Access Key.

## Project Structure

- `backend/`: Node.js Express server to manage meeting sessions.
- `frontend/`: React application using `amazon-chime-sdk-js`.

## Setup Instructions

### 1. Backend Setup
1. Navigate to the `backend` folder.
2. Create a `.env` file based on `.env.example`:
   ```env
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_REGION=us-east-1
   PORT=4000
   ```
3. Run `npm install`.
4. Run `node server.js`.

### 2. Frontend Setup
1. Navigate to the `frontend` folder.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open your browser at `http://localhost:3001`.

## How it Works

1. **Signaling**: When you enter a Room ID and click Join, the frontend calls the `/join` endpoint.
2. **Meeting Creation**: The backend uses the AWS Chime SDK to create a "Meeting" (if it doesn't exist) and an "Attendee".
3. **Session Information**: The backend returns the `JoinInfo` (Meeting and Attendee data).
4. **Media Session**: The frontend uses `amazon-chime-sdk-js` to initialize a `DefaultMeetingSession` and bind audio/video elements to the browser.
5. **Direct Media**: Media flows through AWS Chime's media services (which includes built-in TURN relay), ensuring 100% connectivity even through firewalls.
# Video-Call-App-via-AWS-Chime-SDK
