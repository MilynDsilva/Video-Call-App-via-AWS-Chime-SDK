/**
 * @fileoverview AWS Chime SDK Video Call Backend Server
 * 
 * This Express.js server provides a backend API for managing video call meetings
 * using AWS Chime SDK. It handles meeting creation, attendee management, and
 * recording capabilities with support for both raw and grid-view recording modes.
 * 
 * Key Features:
 * - Create and join Chime SDK meetings
 * - Manage meeting attendees and rosters
 * - Start/stop meeting recordings with configurable modes
 * - CORS-enabled for cross-origin frontend access
 * - Health check endpoint for container orchestration
 * 
 * @requires express - Web framework for Node.js
 * @requires cors - Cross-Origin Resource Sharing middleware
 * @requires @aws-sdk/client-chime-sdk-meetings - AWS Chime SDK for meeting management
 * @requires @aws-sdk/client-chime-sdk-media-pipelines - AWS Chime SDK for recording
 * @requires uuid - UUID generation for unique identifiers
 * @requires dotenv - Environment variable management
 * 
 * @author Milyn
 * @version 1.0.0
 */

const express = require('express');
const cors = require('cors');
const { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } = require('@aws-sdk/client-chime-sdk-meetings');
const { ChimeSDKMediaPipelinesClient, CreateMediaCapturePipelineCommand, DeleteMediaCapturePipelineCommand } = require('@aws-sdk/client-chime-sdk-media-pipelines');
const { v4: uuid } = require('uuid');
require('dotenv').config();

/**
 * Express application instance
 * @type {express.Application}
 */
const app = express();

/**
 * Middleware to parse incoming JSON request bodies
 */
app.use(express.json());

/**
 * CORS (Cross-Origin Resource Sharing) configuration object
 * Defines which origins are allowed to access this API
 * 
 * @typedef {Object} CorsOptions
 * @property {string[]} origin - Array of allowed origin URLs
 * @property {boolean} credentials - Whether to allow credentials (cookies, authorization headers)
 * @property {string[]} methods - Allowed HTTP methods
 * @property {string[]} allowedHeaders - Allowed request headers
 */
const corsOptions = {
    origin: [
        'http://localhost:3001',      // Local development frontend (primary)
        'http://localhost:5623',      // Alternative local development port
        'https://demo-dev.restoreme.care',  // Production HTTPS domain
        'http://demo-dev.restoreme.care'    // Production HTTP domain (fallback)
    ],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

/**
 * Apply CORS middleware to all routes
 */
app.use(cors(corsOptions));

/**
 * AWS SDK client configuration object
 * Configures the AWS region and credentials for Chime SDK clients
 * 
 * @typedef {Object} ClientConfig
 * @property {string} region - AWS region for Chime SDK services
 * @property {Object} [credentials] - Optional AWS credentials object
 * @property {string} credentials.accessKeyId - AWS access key ID
 * @property {string} credentials.secretAccessKey - AWS secret access key
 */
const clientConfig = {
    region: process.env.AWS_REGION || 'us-east-1',
};

/**
 * Add explicit AWS credentials if provided in environment variables
 * If not provided, the SDK will use the default credential provider chain
 * (IAM roles, environment variables, AWS config files, etc.)
 */
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
}

/**
 * AWS Chime SDK Meetings Client
 * Used for creating meetings and managing attendees
 * @type {ChimeSDKMeetingsClient}
 */
const chimeClient = new ChimeSDKMeetingsClient(clientConfig);

/**
 * AWS Chime SDK Media Pipelines Client
 * Used for creating and managing meeting recording pipelines
 * @type {ChimeSDKMediaPipelinesClient}
 */
const mediaClient = new ChimeSDKMediaPipelinesClient(clientConfig);

/**
 * In-memory storage for active meetings
 * Maps meeting titles to their associated data
 * 
 * @typedef {Object} MeetingData
 * @property {Object} meeting - AWS Chime meeting object containing MeetingId, MediaRegion, etc.
 * @property {Object.<string, string>} attendees - Map of attendeeId to attendee name
 * @property {string} [pipelineId] - Media capture pipeline ID (present when recording is active)
 * @property {string} [recordMode] - Recording mode: 'raw' or 'grid'
 * 
 * @type {Object.<string, MeetingData>}
 */
const meetings = {};

/**
 * POST /api/create - Create a new Chime SDK meeting
 * 
 * Creates a new AWS Chime SDK meeting with the specified title. If a meeting
 * with the same title already exists, returns the existing meeting information.
 * This endpoint is idempotent - calling it multiple times with the same title
 * will not create duplicate meetings.
 * 
 * @route POST /api/create
 * @param {Object} req.body - Request body
 * @param {string} req.body.title - Unique identifier/title for the meeting
 * 
 * @returns {Object} 200 - Success response
 * @returns {Object} 200.meeting - AWS Chime meeting object
 * @returns {string} 200.meeting.MeetingId - Unique meeting identifier
 * @returns {string} 200.meeting.MediaRegion - AWS region for media
 * @returns {Object} 200.meeting.MediaPlacement - Media endpoint URLs
 * 
 * @returns {Object} 500 - Error response
 * @returns {string} 500.error - Error message
 * 
 * @example
 * // Request
 * POST /api/create
 * { "title": "patient-doctor-consultation-123" }
 * 
 * // Response
 * {
 *   "meeting": {
 *     "MeetingId": "abc-123-def",
 *     "MediaRegion": "us-east-1",
 *     "MediaPlacement": { ... }
 *   }
 * }
 */
app.post('/api/create', async (req, res) => {
    const { title } = req.body;
    try {
        // Check if meeting already exists to avoid duplicates
        if (!meetings[title]) {
            // Create a new Chime SDK meeting
            const createMeetingCommand = new CreateMeetingCommand({
                ClientRequestToken: uuid(),  // Unique token for idempotency
                MediaRegion: 'us-east-1',    // AWS region for media routing
                ExternalMeetingId: title,    // Human-readable meeting identifier
            });
            const meetingResult = await chimeClient.send(createMeetingCommand);
            // Store meeting data with empty attendees object
            meetings[title] = { meeting: meetingResult.Meeting, attendees: {} };
        }
        // Return meeting information (existing or newly created)
        res.json({ meeting: meetings[title].meeting });
    } catch (err) {
        // Handle AWS SDK errors or other exceptions
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/roster/:title - Get current attendee roster for a meeting
 * 
 * Retrieves the current list of attendees in a meeting without creating
 * a new attendee. Used for real-time roster synchronization when new
 * participants join.
 * 
 * @route GET /api/roster/:title
 * @param {string} req.params.title - Meeting title/identifier
 * 
 * @returns {Object} 200 - Success response
 * @returns {Object.<string, string>} 200.roster - Map of attendeeId to attendee name
 * 
 * @returns {Object} 404 - Meeting not found
 * @returns {string} 404.error - Error message
 * 
 * @example
 * // Request
 * GET /api/roster/patient-doctor-consultation-123
 * 
 * // Response
 * {
 *   "roster": {
 *     "xyz-456": "Dr. Smith",
 *     "def-789": "Patient John"
 *   }
 * }
 */
app.get('/api/roster/:title', (req, res) => {
    const { title } = req.params;
    const meetingData = meetings[title];

    if (!meetingData) {
        return res.status(404).json({ error: 'Meeting not found' });
    }

    res.json({ roster: meetingData.attendees || {} });
});


/**
 * POST /api/join - Join an existing meeting or create and join a new one
 * 
 * Allows a user to join a Chime SDK meeting. If the meeting doesn't exist,
 * it will be created automatically. Creates a new attendee for the user and
 * returns both the meeting and attendee information along with the current
 * roster of all participants.
 * 
 * @route POST /api/join
 * @param {Object} req.body - Request body
 * @param {string} req.body.title - Meeting title/identifier to join
 * @param {string} req.body.name - Display name of the attendee
 * 
 * @returns {Object} 200 - Success response
 * @returns {Object} 200.JoinInfo - Information needed to join the meeting
 * @returns {Object} 200.JoinInfo.Meeting - AWS Chime meeting object
 * @returns {Object} 200.JoinInfo.Attendee - AWS Chime attendee object
 * @returns {string} 200.JoinInfo.Attendee.AttendeeId - Unique attendee identifier
 * @returns {string} 200.JoinInfo.Attendee.ExternalUserId - External user identifier
 * @returns {Object.<string, string>} 200.Roster - Map of attendeeId to attendee name
 * 
 * @returns {Object} 500 - Error response
 * @returns {string} 500.error - Error message
 * 
 * @example
 * // Request
 * POST /api/join
 * { "title": "patient-doctor-consultation-123", "name": "Dr. Smith" }
 * 
 * // Response
 * {
 *   "JoinInfo": {
 *     "Meeting": { "MeetingId": "abc-123", ... },
 *     "Attendee": { "AttendeeId": "xyz-456", ... }
 *   },
 *   "Roster": {
 *     "xyz-456": "Dr. Smith",
 *     "def-789": "Patient John"
 *   }
 * }
 */
app.post('/api/join', async (req, res) => {
    const { title, name } = req.body;

    try {
        let meeting;
        // Create meeting if it doesn't exist
        if (!meetings[title]) {
            const createMeetingCommand = new CreateMeetingCommand({
                ClientRequestToken: uuid(),  // Unique token for idempotency
                MediaRegion: 'us-east-1',    // AWS region for media routing
                ExternalMeetingId: title,    // Human-readable meeting identifier
            });
            const meetingResult = await chimeClient.send(createMeetingCommand);
            meeting = meetingResult.Meeting;
            // Initialize meeting data with empty attendees
            meetings[title] = { meeting, attendees: {} };
        } else {
            // Use existing meeting
            meeting = meetings[title].meeting;
        }

        // Create a new attendee for this user
        const createAttendeeCommand = new CreateAttendeeCommand({
            MeetingId: meeting.MeetingId,  // Associate with the meeting
            ExternalUserId: uuid(),        // Unique identifier for this attendee
        });
        const attendeeResult = await chimeClient.send(createAttendeeCommand);

        // Store attendee name in the roster
        const attendeeId = attendeeResult.Attendee.AttendeeId;
        // Ensure attendees object exists (defensive programming)
        if (!meetings[title].attendees) {
            meetings[title].attendees = {};
        }
        meetings[title].attendees[attendeeId] = name;

        // Return meeting info, attendee credentials, and current roster
        res.json({
            JoinInfo: {
                Meeting: meeting,
                Attendee: attendeeResult.Attendee,
            },
            Roster: meetings[title].attendees  // All current participants
        });
    } catch (err) {
        console.error('Error joining meeting:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/record/start - Start recording a meeting
 * 
 * Initiates a media capture pipeline to record the specified meeting.
 * Supports two recording modes:
 * - 'raw': Records separate audio, video, and content streams
 * - 'grid': Records a composited grid view with all participants in HD
 * 
 * Recordings are stored in the configured S3 bucket (meet-recordings-rm).
 * Only one recording can be active per meeting at a time.
 * 
 * @route POST /api/record/start
 * @param {Object} req.body - Request body
 * @param {string} req.body.title - Meeting title/identifier
 * @param {string} req.body.mode - Recording mode: 'raw' or 'grid'
 * 
 * @returns {Object} 200 - Success response
 * @returns {string} 200.message - Confirmation message with mode
 * @returns {string} 200.pipelineId - Media capture pipeline identifier
 * 
 * @returns {Object} 404 - Meeting not found
 * @returns {string} 404.error - Error message
 * 
 * @returns {Object} 400 - Recording already in progress
 * @returns {string} 400.error - Error message
 * 
 * @returns {Object} 500 - Server error
 * @returns {string} 500.error - Error message
 * 
 * @example
 * // Request (Grid Mode)
 * POST /api/record/start
 * { "title": "patient-doctor-consultation-123", "mode": "grid" }
 * 
 * // Response
 * {
 *   "message": "Recording started (grid)",
 *   "pipelineId": "pipeline-abc-123"
 * }
 */
app.post('/api/record/start', async (req, res) => {
    const { title, mode } = req.body; // mode: 'raw' or 'grid'
    const meetingData = meetings[title];

    // Validate meeting exists
    if (!meetingData) return res.status(404).json({ error: 'Meeting not found' });
    // Prevent multiple simultaneous recordings
    if (meetingData.pipelineId) return res.status(400).json({ error: 'Already recording' });

    try {
        // Extract AWS account ID from meeting ARN or use environment variable
        const accountId = process.env.AWS_ACCOUNT_ID || meetingData.meeting.MeetingArn.split(':')[4];

        /**
         * Artifacts configuration defines what media streams to capture
         * Audio is always captured in both modes
         */
        const artifactsConfig = {
            Audio: { MuxType: 'AudioOnly' }  // Separate audio track
        };

        if (mode === 'grid') {
            // Grid mode: Composite all participants into a single video
            artifactsConfig.Video = { State: 'Disabled' };     // No individual video streams
            artifactsConfig.Content = { State: 'Disabled' };   // No screen share streams
            artifactsConfig.CompositedVideo = {
                State: 'Enabled',
                Layout: 'GridView',           // Tile layout with all participants
                Resolution: 'HD',             // 1280x720 resolution
                GridViewConfiguration: {
                    ContentShareLayout: 'PresenterOnly',  // Show presenter when sharing
                }
            };
        } else {
            // Raw mode: Capture individual streams separately
            artifactsConfig.Video = { State: 'Enabled', MuxType: 'VideoOnly' };      // Individual video streams
            artifactsConfig.Content = { State: 'Enabled', MuxType: 'ContentOnly' };  // Screen share streams
        }

        // Create the media capture pipeline
        const createPipelineCommand = new CreateMediaCapturePipelineCommand({
            SourceType: 'ChimeSdkMeeting',  // Source is a Chime SDK meeting
            SourceArn: `arn:aws:chime::${accountId}:meeting:${meetingData.meeting.MeetingId}`,
            SinkType: 'S3Bucket',           // Destination is S3
            SinkArn: `arn:aws:s3:::meet-recordings-rm`,  // S3 bucket for recordings
            ChimeSdkMeetingConfiguration: {
                ArtifactsConfiguration: artifactsConfig
            }
        });

        const result = await mediaClient.send(createPipelineCommand);
        // Store pipeline ID and mode for later reference
        meetings[title].pipelineId = result.MediaCapturePipeline.MediaPipelineId;
        meetings[title].recordMode = mode;
        res.json({ message: `Recording started (${mode})`, pipelineId: meetings[title].pipelineId });
    } catch (err) {
        console.error('Recording start error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/record/stop - Stop recording a meeting
 * 
 * Stops an active media capture pipeline for the specified meeting.
 * The recording will be finalized and saved to the S3 bucket.
 * After stopping, the pipeline ID is cleared from the meeting data.
 * 
 * @route POST /api/record/stop
 * @param {Object} req.body - Request body
 * @param {string} req.body.title - Meeting title/identifier
 * 
 * @returns {Object} 200 - Success response
 * @returns {string} 200.message - Confirmation message
 * 
 * @returns {Object} 400 - No active recording found
 * @returns {string} 400.error - Error message
 * 
 * @returns {Object} 500 - Server error
 * @returns {string} 500.error - Error message
 * 
 * @example
 * // Request
 * POST /api/record/stop
 * { "title": "patient-doctor-consultation-123" }
 * 
 * // Response
 * { "message": "Recording stopped" }
 */
app.post('/api/record/stop', async (req, res) => {
    const { title } = req.body;
    const meetingData = meetings[title];

    // Validate that meeting exists and has an active recording
    if (!meetingData || !meetingData.pipelineId) {
        return res.status(400).json({ error: 'Not recording' });
    }

    try {
        // Delete (stop) the media capture pipeline
        const deleteCommand = new DeleteMediaCapturePipelineCommand({
            MediaPipelineId: meetingData.pipelineId
        });
        await mediaClient.send(deleteCommand);
        // Clear the pipeline ID to indicate recording has stopped
        meetings[title].pipelineId = null;
        res.json({ message: 'Recording stopped' });
    } catch (err) {
        console.error('Recording stop error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /health - Health check endpoint
 * 
 * Returns the health status of the server. Used by Docker, Kubernetes,
 * load balancers, and monitoring systems to verify the service is running.
 * 
 * @route GET /health
 * @returns {Object} 200 - Health status response
 * @returns {string} 200.status - Always 'healthy' when server is responsive
 * @returns {string} 200.timestamp - Current server time in ISO format
 * 
 * @example
 * // Request
 * GET /health
 * 
 * // Response
 * {
 *   "status": "healthy",
 *   "timestamp": "2026-02-07T04:40:30.123Z"
 * }
 */
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Server port configuration
 * Uses PORT environment variable or defaults to 5629
 * @type {number}
 */
const PORT = process.env.PORT || 5629;

/**
 * Start the Express server
 * Binds to 0.0.0.0 to accept connections from any network interface
 * (required for Docker containers)
 */
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
