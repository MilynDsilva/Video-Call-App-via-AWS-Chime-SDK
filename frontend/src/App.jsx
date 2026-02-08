import { useState, useRef, useEffect } from 'react';
import {
    Mic,
    MicOff,
    Video,
    VideoOff,
    Phone,
    Settings,
    Circle,
    Square,
    RefreshCw
} from 'lucide-react';
import {
    ConsoleLogger,
    DefaultDeviceController,
    DefaultMeetingSession,
    LogLevel,
    MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || '';

// Helper function to generate random room ID
const generateRoomId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

function App() {
    const [inCall, setInCall] = useState(false);
    const [name, setName] = useState('');
    const [roomId, setRoomId] = useState(generateRoomId()); // Auto-generate on load
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [generatedLink, setGeneratedLink] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [attendeeRoster, setAttendeeRoster] = useState({});
    const [remoteAttendeeId, setRemoteAttendeeId] = useState(null);
    const [notifications, setNotifications] = useState([]);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const previewVideoRef = useRef(null);
    const sessionRef = useRef(null);
    const previewStreamRef = useRef(null);
    const audioInputRef = useRef(null);
    const videoInputRef = useRef(null);

    // URL Param Check & Camera Preview
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlRoom = params.get('roomId');
        if (urlRoom && urlRoom !== roomId) {
            setRoomId(urlRoom);
        }

        if (!inCall) {
            const startPreview = async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    if (previewVideoRef.current) {
                        previewVideoRef.current.srcObject = stream;
                        previewStreamRef.current = stream;
                    }
                } catch (err) {
                    console.error('Preview failed:', err);
                }
            };
            startPreview();
        }
        return () => {
            if (previewStreamRef.current) {
                previewStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [inCall]);

    // Sync URL when roomId changes
    useEffect(() => {
        if (roomId && !inCall) {
            const newUrl = `${window.location.pathname}?roomId=${encodeURIComponent(roomId)}`;
            window.history.replaceState({}, '', newUrl);
        }
    }, [roomId, inCall]);

    // Show notification helper
    const showNotification = (message, type) => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, message, type }]);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 3000);
    };

    const handleCreateMeeting = async () => {
        if (!roomId) return alert('Enter a room ID first');
        setIsGenerating(true);
        try {
            const response = await fetch(`${API_URL}/api/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: roomId }),
            });
            const data = await response.json();
            if (response.ok) {
                const link = `${window.location.origin}${window.location.pathname}?roomId=${roomId}`;
                setGeneratedLink(link);
            } else {
                alert(data.error);
            }
        } catch (error) {
            alert('Failed to create meeting');
        } finally {
            setIsGenerating(false);
        }
    };

    const toggleRecording = async (mode) => {
        const endpoint = isRecording ? `${API_URL}/api/record/stop` : `${API_URL}/api/record/start`;
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: roomId, mode }),
            });
            const data = await response.json();
            if (response.ok) {
                setIsRecording(!isRecording);
                alert(data.message);
            } else {
                alert(data.error);
            }
        } catch (error) {
            alert('Recording action failed');
        }
    };

    const joinMeeting = async (e) => {
        if (e) e.preventDefault();

        // Validate password
        if (password !== '9762') {
            alert('Incorrect password. Please try again.');
            return;
        }

        setIsLoading(true);

        // Stop preview before joining
        if (previewStreamRef.current) {
            previewStreamRef.current.getTracks().forEach(track => track.stop());
        }

        try {
            const response = await fetch(`${API_URL}/api/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: roomId, name }),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Server error');

            // Store the roster
            if (data.Roster) {
                setAttendeeRoster(data.Roster);
            }

            setInCall(true);
            // Wait for UI to render video elements
            setTimeout(() => initializeChime(data.JoinInfo), 100);
        } catch (error) {
            console.error('Failed to join:', error);
            alert(`Failed to join: ${error.message}`);
            setIsLoading(false);
        }
    };

    const initializeChime = async (joinInfo) => {
        try {
            const logger = new ConsoleLogger('ChimeMeeting', LogLevel.INFO);
            const deviceController = new DefaultDeviceController(logger);
            const configuration = new MeetingSessionConfiguration(joinInfo.Meeting, joinInfo.Attendee);

            const meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
            sessionRef.current = meetingSession;

            const audioVideo = meetingSession.audioVideo;

            // Attendee Presence Observer - Updates roster when attendees join/leave
            const attendeePresenceObserver = {
                attendeeIdPresenceHandler: async (attendeeId, present, externalUserId, dropped) => {
                    console.log(`Attendee ${attendeeId} presence changed: ${present ? 'joined' : 'left'}`);

                    if (present) {
                        // When a new attendee joins, fetch the updated roster from backend
                        try {
                            const response = await fetch(`${API_URL}/api/roster/${encodeURIComponent(roomId)}`);
                            const data = await response.json();
                            if (data.roster) {
                                console.log('Updated roster:', data.roster);
                                const attendeeName = data.roster[attendeeId] || 'Someone';

                                // Don't show notification for yourself joining
                                const myAttendeeId = joinInfo.Attendee.AttendeeId;
                                if (attendeeId !== myAttendeeId) {
                                    showNotification(`${attendeeName} joined`, 'join');
                                }

                                setAttendeeRoster(data.roster);
                            }
                        } catch (error) {
                            console.error('Failed to update roster:', error);
                        }
                    } else {
                        // Get the name before removing from roster
                        const leavingName = attendeeRoster[attendeeId] || 'Someone';
                        showNotification(`${leavingName} left`, 'leave');

                        // Remove attendee from roster when they leave
                        setAttendeeRoster(prev => {
                            const updated = { ...prev };
                            delete updated[attendeeId];
                            return updated;
                        });
                    }
                }
            };

            // Subscribe to attendee presence updates
            audioVideo.realtimeSubscribeToAttendeeIdPresence(
                attendeePresenceObserver.attendeeIdPresenceHandler
            );

            // Video Tile Observer
            const observer = {
                videoTileDidUpdate: (tileState) => {
                    console.log('Video tile updated:', tileState);
                    if (!tileState.boundAttendeeId) return;

                    if (tileState.localTile) {
                        if (localVideoRef.current) {
                            audioVideo.bindVideoElement(tileState.tileId, localVideoRef.current);
                        }
                    } else {
                        if (remoteVideoRef.current) {
                            audioVideo.bindVideoElement(tileState.tileId, remoteVideoRef.current);
                            // Update state to trigger re-render with name
                            setRemoteAttendeeId(tileState.boundAttendeeId);
                        }
                    }
                },
                videoTileDidRemove: (tileId) => {
                    console.log('Video tile removed:', tileId);
                    audioVideo.unbindVideoElement(tileId);
                    // Clear remote attendee if their tile is removed
                    setRemoteAttendeeId(null);
                }
            };

            // Use addObserver if addVideoTileObserver is missing for some reason (SDK edge case)
            if (typeof audioVideo.addVideoTileObserver === 'function') {
                audioVideo.addVideoTileObserver(observer);
            } else {
                audioVideo.addObserver(observer);
            }

            // Setup Devices
            const audioInputs = await audioVideo.listAudioInputDevices();
            const videoInputs = await audioVideo.listVideoInputDevices();

            if (audioInputs.length > 0) {
                audioInputRef.current = audioInputs[0].deviceId;
                await audioVideo.startAudioInput(audioInputs[0].deviceId);
            }

            if (videoInputs.length > 0) {
                videoInputRef.current = videoInputs[0].deviceId;
                await audioVideo.startVideoInput(videoInputs[0].deviceId);
            }

            // Setup Audio Output
            const audioOutput = document.createElement('audio');
            audioVideo.bindAudioElement(audioOutput);

            // Start Session
            audioVideo.start();
            audioVideo.startLocalVideoTile();
        } catch (error) {
            console.error('Initialization error:', error);
            alert(`Camera/Mic Error: ${error.message}. If on mobile, ensure you are using HTTPS or localhost.`);
            setInCall(false);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMute = () => {
        if (!sessionRef.current) return;
        const audioVideo = sessionRef.current.audioVideo;
        if (isMuted) {
            audioVideo.realtimeUnmuteLocalAudio();
        } else {
            audioVideo.realtimeMuteLocalAudio();
        }
        setIsMuted(!isMuted);
    };

    const toggleCamera = async () => {
        if (!sessionRef.current) return;
        const audioVideo = sessionRef.current.audioVideo;
        if (isCamOff) {
            await audioVideo.startVideoInput(videoInputRef.current);
            audioVideo.startLocalVideoTile();
        } else {
            await audioVideo.stopVideoInput();
            audioVideo.stopLocalVideoTile();
        }
        setIsCamOff(!isCamOff);
    };

    const leaveCall = () => {
        if (sessionRef.current) {
            sessionRef.current.audioVideo.stop();
            sessionRef.current = null;
        }
        setInCall(false);
        setIsMuted(false);
        setIsCamOff(false);
        setIsRecording(false);
        // Clear URL params
        window.history.replaceState({}, '', window.location.pathname);
    };

    if (inCall) {
        return (
            <div className="call-layout">
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                        <p>Joining Meeting...</p>
                    </div>
                )}

                {/* Notification Toasts */}
                <div className="notification-container">
                    {notifications.map(notif => (
                        <div
                            key={notif.id}
                            className={`notification ${notif.type}`}
                        >
                            {notif.message}
                        </div>
                    ))}
                </div>

                <div className="video-section">
                    <div className="video-grid">
                        <div className="video-tile">
                            <video ref={localVideoRef} autoPlay muted playsInline />
                            <div className="tile-label">You ({name})</div>
                        </div>
                        <div className="video-tile">
                            <video ref={remoteVideoRef} autoPlay playsInline />
                            <div className="tile-label">
                                {remoteAttendeeId
                                    ? (attendeeRoster[remoteAttendeeId] || 'Remote Participant')
                                    : 'Waiting for participant...'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="control-bar">
                    <div className="meeting-info">
                        Meeting: {roomId}
                    </div>

                    <div className="main-controls">
                        <button
                            className={`icon-btn ${isMuted ? 'off' : ''}`}
                            onClick={toggleMute}
                            title={isMuted ? 'Unmute' : 'Mute'}
                        >
                            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                        </button>
                        <button
                            className={`icon-btn ${isCamOff ? 'off' : ''}`}
                            onClick={toggleCamera}
                            title={isCamOff ? 'Turn on Camera' : 'Turn off Camera'}
                        >
                            {isCamOff ? <VideoOff size={24} /> : <Video size={24} />}
                        </button>

                        {!isRecording ? (
                            <>
                                <button
                                    className="icon-btn"
                                    onClick={() => toggleRecording('raw')}
                                    title="Start Raw Recording"
                                >
                                    <Circle size={20} />
                                </button>
                                <button
                                    className="icon-btn"
                                    onClick={() => toggleRecording('grid')}
                                    title="Start Grid Recording"
                                >
                                    <Square size={20} />
                                </button>
                            </>
                        ) : (
                            <button
                                className="icon-btn off"
                                onClick={() => toggleRecording()}
                                title="Stop Recording"
                                style={{ backgroundColor: '#ea4335', color: 'white' }}
                            >
                                <Square size={20} fill="currentColor" />
                            </button>
                        )}

                        <button
                            className="icon-btn end"
                            onClick={leaveCall}
                            title="End Call"
                        >
                            <Phone size={24} />
                        </button>
                    </div>

                    <div className="side-controls">
                        <button className="icon-btn" title="Settings">
                            <Settings size={24} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="join-container">
            <div className="join-content">
                <div className="preview-container">
                    <video ref={previewVideoRef} autoPlay muted playsInline />
                    <div className="preview-overlay">
                        {(!name || !roomId) ? 'Enter details to join' : 'Ready to join?'}
                    </div>
                </div>

                <div className="join-card">
                    <h1>MediCall {isAdmin ? 'Admin' : 'AWS'}</h1>
                    <p>{isAdmin ? 'Create and manage meetings' : 'Secure Consultation'}</p>
                    {window.isSecureContext === false && (
                        <div style={{ backgroundColor: '#ea4335', color: 'white', padding: '10px', borderRadius: '4px', marginBottom: '16px', fontSize: '12px' }}>
                            ⚠️ Camera/Mic will not work because this is not a secure connection (HTTPS).
                        </div>
                    )}

                    {!isAdmin ? (
                        <form onSubmit={joinMeeting}>
                            <input
                                className="input-field"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Your Name"
                                required
                            />
                            <div style={{ position: 'relative', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input
                                    className="input-field"
                                    value={roomId}
                                    onChange={e => setRoomId(e.target.value)}
                                    placeholder="Meeting Code (e.g. 123)"
                                    required
                                    style={{ flex: 1 }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setRoomId(generateRoomId())}
                                    style={{
                                        background: 'rgba(138, 180, 248, 0.1)',
                                        border: '1px solid rgba(138, 180, 248, 0.3)',
                                        borderRadius: '8px',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s',
                                        minWidth: '48px',
                                        height: '48px'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(138, 180, 248, 0.2)';
                                        e.currentTarget.style.transform = 'rotate(180deg)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(138, 180, 248, 0.1)';
                                        e.currentTarget.style.transform = 'rotate(0deg)';
                                    }}
                                    title="Generate new room ID"
                                >
                                    <RefreshCw size={20} color="#8ab4f8" />
                                </button>
                            </div>
                            <input
                                className="input-field"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Password"
                                required
                            />
                            <button type="submit" className="join-btn" disabled={isLoading}>
                                {isLoading ? 'Connecting...' : 'Join Meeting'}
                            </button>
                            <button type="button" className="join-btn" style={{ background: 'transparent', border: '1px solid #5f6368', color: '#8ab4f8' }} onClick={() => setIsAdmin(true)}>
                                Switch to Admin
                            </button>
                        </form>
                    ) : (
                        <div className="admin-controls">
                            <input
                                className="input-field"
                                value={roomId}
                                onChange={e => setRoomId(e.target.value)}
                                placeholder="Meeting Code (e.g. 123)"
                            />
                            <button className="join-btn" onClick={handleCreateMeeting} disabled={isGenerating}>
                                {isGenerating ? 'Generating...' : 'Create Meeting & Get Link'}
                            </button>

                            {generatedLink && (
                                <div style={{ marginTop: '20px', background: '#3c4043', padding: '12px', borderRadius: '4px', wordBreak: 'break-all' }}>
                                    <p style={{ fontSize: '12px', marginBottom: '8px' }}>Share this link:</p>
                                    <code style={{ fontSize: '11px', color: '#8ab4f8' }}>{generatedLink}</code>
                                    <button
                                        className="join-btn"
                                        style={{ marginTop: '10px', fontSize: '12px', padding: '6px' }}
                                        onClick={() => {
                                            navigator.clipboard.writeText(generatedLink);
                                            alert('Link copied!');
                                        }}
                                    >
                                        Copy Link
                                    </button>
                                </div>
                            )}

                            <button type="button" className="join-btn" style={{ background: 'transparent', border: '1px solid #5f6368', color: '#8ab4f8', marginTop: '10px' }} onClick={() => setIsAdmin(false)}>
                                Back to Join
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
