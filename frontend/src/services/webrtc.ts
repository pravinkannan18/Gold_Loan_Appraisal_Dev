/**
 * WebRTC/WebSocket Service for Gold Loan Appraisal
 * 
 * Supports two modes:
 * 1. WebRTC mode - When aiortc is available on backend (ultra-low latency)
 * 2. WebSocket mode - Fallback when aiortc is not available
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE = API_BASE.replace('http', 'ws');

export interface WebRTCSession {
    sessionId: string;
    mode: 'webrtc' | 'websocket';
    peerConnection?: RTCPeerConnection;
    websocket?: WebSocket;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
}

export interface DetectionStatus {
    rubbing_detected: boolean;
    acid_detected: boolean;
    gold_purity: string | null;
}

export interface SessionStatus {
    session_id: string;
    created_at: string;
    current_task: 'rubbing' | 'acid' | 'done';
    detection_status: DetectionStatus;
    connection_state: string;
    mode: 'webrtc' | 'websocket';
}

export interface FrameResult {
    frame: string;
    status: {
        current_task: string;
        rubbing_detected: boolean;
        acid_detected: boolean;
        gold_purity: string | null;
    };
    process_ms: number;
}

/**
 * WebRTC/WebSocket Service class
 */
export class WebRTCService {
    private session: WebRTCSession | null = null;
    private onRemoteStream: ((stream: MediaStream) => void) | null = null;
    private onAnnotatedFrame: ((frame: string) => void) | null = null;
    private onStatusChange: ((status: SessionStatus) => void) | null = null;
    private onConnectionStateChange: ((state: string) => void) | null = null;
    private statusPollingInterval: number | null = null;
    private frameInterval: number | null = null;
    private videoElement: HTMLVideoElement | null = null;
    private canvasElement: HTMLCanvasElement | null = null;

    /**
     * Connect using the best available method
     */
    async connect(
        videoElement?: HTMLVideoElement,
        cameraId?: string
    ): Promise<WebRTCSession> {
        // First check what mode the backend supports
        const statusResponse = await fetch(`${API_BASE}/api/webrtc/status`);
        const status = await statusResponse.json();

        const mode = status.webrtc?.webrtc_available ? 'webrtc' : 'websocket';
        console.log(`🔧 Backend mode: ${mode}`);

        if (mode === 'webrtc') {
            return this.connectWebRTC(videoElement, cameraId);
        } else {
            return this.connectWebSocket(videoElement, cameraId);
        }
    }

    /**
     * Connect via WebSocket (fallback mode)
     */
    private async connectWebSocket(
        videoElement?: HTMLVideoElement,
        cameraId?: string
    ): Promise<WebRTCSession> {
        try {
            // Get camera stream with optimized constraints for low latency
            const constraints: MediaStreamConstraints = {
                video: cameraId
                    ? {
                        deviceId: { exact: cameraId },
                        width: { ideal: 3840, min: 1280 },
                        height: { ideal: 2160, min: 720 },
                        aspectRatio: { ideal: 16/9 },
                        frameRate: { ideal: 15, max: 30 }
                    }
                    : {
                        width: { ideal: 3840, min: 1280 },
                        height: { ideal: 2160, min: 720 },
                        aspectRatio: { ideal: 16/9 },
                        frameRate: { ideal: 15, max: 30 }
                    },
                audio: false
            };

            const localStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Display local stream
            if (videoElement) {
                videoElement.srcObject = localStream;
                this.videoElement = videoElement;
            }

            // Create canvas for frame capture (smaller for faster processing)
            this.canvasElement = document.createElement('canvas');
            this.canvasElement.width = 320;
            this.canvasElement.height = 240;

            // Create session on backend
            const sessionResponse = await fetch(`${API_BASE}/api/webrtc/session/create`, {
                method: 'POST'
            });
            const sessionResult = await sessionResponse.json();

            if (!sessionResult.success) {
                throw new Error(sessionResult.error || 'Failed to create session');
            }

            const sessionId = sessionResult.session_id;

            // Connect WebSocket
            const ws = new WebSocket(`${WS_BASE}/api/webrtc/ws/${sessionId}`);

            await new Promise<void>((resolve, reject) => {
                ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    resolve();
                };
                ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    reject(error);
                };
                setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
            });

            // Handle incoming messages
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'frame') {
                        // Display annotated frame
                        if (this.onAnnotatedFrame) {
                            this.onAnnotatedFrame(msg.frame);
                        }

                        // Update status
                        if (this.onStatusChange && msg.status) {
                            this.onStatusChange({
                                session_id: sessionId,
                                created_at: new Date().toISOString(),
                                current_task: msg.status.current_task,
                                detection_status: {
                                    rubbing_detected: msg.status.rubbing_detected,
                                    acid_detected: msg.status.acid_detected,
                                    gold_purity: msg.status.gold_purity
                                },
                                connection_state: 'connected',
                                mode: 'websocket'
                            });
                        }
                    } else if (msg.type === 'error') {
                        console.error('Server error:', msg.message);
                    }
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };

            ws.onclose = () => {
                console.log('🔌 WebSocket closed');
                if (this.onConnectionStateChange) {
                    this.onConnectionStateChange('disconnected');
                }
            };

            // Store session
            this.session = {
                sessionId,
                mode: 'websocket',
                websocket: ws,
                localStream,
                remoteStream: null
            };

            // Start frame capture loop
            this.startFrameCapture();

            if (this.onConnectionStateChange) {
                this.onConnectionStateChange('connected');
            }

            console.log('✅ WebSocket session established:', sessionId);
            return this.session;

        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            throw error;
        }
    }

    /**
     * Start capturing and sending frames via WebSocket
     */
    private startFrameCapture() {
        if (this.frameInterval) {
            clearInterval(this.frameInterval);
        }

        this.frameInterval = window.setInterval(() => {
            if (!this.session?.websocket || this.session.websocket.readyState !== WebSocket.OPEN) {
                return;
            }

            if (!this.videoElement || !this.canvasElement) {
                return;
            }

            try {
                const ctx = this.canvasElement.getContext('2d');
                if (!ctx) return;

                // Draw video frame to canvas (original video size for best quality)
                this.canvasElement.width = this.videoElement.videoWidth;
                this.canvasElement.height = this.videoElement.videoHeight;
                ctx.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);

                // Convert to base64 with original quality
                const frameData = this.canvasElement.toDataURL('image/jpeg', 1.0);

                // Send to server
                this.session.websocket.send(JSON.stringify({
                    action: 'frame',
                    data: frameData
                }));
            } catch (e) {
                console.error('Frame capture error:', e);
            }
        }, 66); // ~15 FPS for WebSocket mode (faster than before)
    }

    /**
     * Connect via full WebRTC (when aiortc available)
     */
    private async connectWebRTC(
        videoElement?: HTMLVideoElement,
        cameraId?: string
    ): Promise<WebRTCSession> {
        try {
            // Optimized constraints for low latency
            const constraints: MediaStreamConstraints = {
                video: cameraId
                    ? {
                        deviceId: { exact: cameraId },
                        width: { ideal: 3840, min: 1280 },
                        height: { ideal: 2160, min: 720 },
                        aspectRatio: { ideal: 16/9 },
                        frameRate: { ideal: 15, max: 30 }
                    }
                    : {
                        width: { ideal: 3840, min: 1280 },
                        height: { ideal: 2160, min: 720 },
                        aspectRatio: { ideal: 16/9 },
                        frameRate: { ideal: 15, max: 30 }
                    },
                audio: false
            };

            const localStream = await navigator.mediaDevices.getUserMedia(constraints);

            if (videoElement) {
                videoElement.srcObject = localStream;
            }

            const config: RTCConfiguration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            };

            const pc = new RTCPeerConnection(config);
            console.log('🔧 Created RTCPeerConnection');

            localStream.getTracks().forEach(track => {
                console.log(`📤 Adding local track: ${track.kind}`);
                pc.addTrack(track, localStream);
            });

            const remoteStream = new MediaStream();

            pc.ontrack = (event) => {
                console.log('📥 ontrack event received!');
                console.log('  Track kind:', event.track.kind);
                console.log('  Track readyState:', event.track.readyState);
                console.log('  Streams count:', event.streams.length);

                event.streams[0].getTracks().forEach(track => {
                    console.log(`  Adding remote track: ${track.kind}`);
                    remoteStream.addTrack(track);
                });

                console.log('  Remote stream tracks:', remoteStream.getTracks().length);

                if (this.onRemoteStream) {
                    this.onRemoteStream(remoteStream);
                }
            };

            pc.onconnectionstatechange = () => {
                console.log('🔗 Connection state:', pc.connectionState);
                if (this.onConnectionStateChange) {
                    this.onConnectionStateChange(pc.connectionState);
                }
            };

            pc.oniceconnectionstatechange = () => {
                console.log('🧊 ICE connection state:', pc.iceConnectionState);
            };

            pc.onnegotiationneeded = () => {
                console.log('🔄 Negotiation needed');
            };

            // Variable to store session ID for data channel handler
            let sessionId = '';

            // Create data channel from CLIENT side (standard WebRTC pattern)
            const statusChannel = pc.createDataChannel('status', { ordered: true });
            console.log('📡 Created data channel from client');

            statusChannel.onopen = () => {
                console.log('📡✅ Status data channel OPENED');
            };

            statusChannel.onclose = () => {
                console.log('📡❌ Status data channel closed');
            };

            statusChannel.onmessage = (msgEvent) => {
                console.log('📡📩 Data channel message received:', msgEvent.data?.substring(0, 100));
                try {
                    const data = JSON.parse(msgEvent.data);
                    console.log('📡 Parsed data channel message:', JSON.stringify(data));

                    if (data.type === 'status') {
                        console.log('📡 Status update - calling onStatusChange:', !!this.onStatusChange);
                        if (this.onStatusChange) {
                            const statusUpdate = {
                                session_id: sessionId || this.session?.sessionId || '',
                                created_at: new Date().toISOString(),
                                current_task: data.current_task,
                                detection_status: {
                                    rubbing_detected: data.rubbing_detected,
                                    acid_detected: data.acid_detected,
                                    gold_purity: data.gold_purity
                                },
                                connection_state: 'connected',
                                mode: 'webrtc' as const
                            };
                            console.log('📡 Calling onStatusChange with:', JSON.stringify(statusUpdate));
                            this.onStatusChange(statusUpdate);
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse data channel message:', e, msgEvent.data);
                }
            };

            statusChannel.onerror = (error) => {
                console.error('📡 Data channel error:', error);
            };

            const offer = await pc.createOffer();

            await pc.setLocalDescription(offer);
            await this.waitForIceGathering(pc);

            const response = await fetch(`${API_BASE}/api/webrtc/offer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sdp: pc.localDescription?.sdp,
                    type: pc.localDescription?.type
                })
            });

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to create session');
            }

            // Set session ID for data channel handler
            sessionId = result.session_id;
            console.log('📡 Session ID set for data channel:', sessionId);

            await pc.setRemoteDescription(new RTCSessionDescription(result.answer));

            this.session = {
                sessionId: result.session_id,
                mode: 'webrtc',
                peerConnection: pc,
                localStream,
                remoteStream
            };

            // CRITICAL: Do NOT poll status for WebRTC mode
            // Status polling causes HTTP requests that interfere with the peer connection
            // For WebRTC, status updates come via data channel
            console.log('✅ WebRTC mode - status polling DISABLED, using data channel');

            return this.session;

        } catch (error) {
            console.error('❌ WebRTC connection failed:', error);
            throw error;
        }
    }

    private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }
            const check = () => {
                if (pc.iceGatheringState === 'complete') {
                    pc.removeEventListener('icegatheringstatechange', check);
                    resolve();
                }
            };
            pc.addEventListener('icegatheringstatechange', check);
            setTimeout(() => {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }, 3000);
        });
    }

    private startStatusPolling(interval: number = 500) {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
        }
        console.log(`🔄 Starting status polling (interval: ${interval}ms)`);
        this.statusPollingInterval = window.setInterval(async () => {
            if (this.session && this.onStatusChange) {
                const status = await this.getSessionStatus();
                if (status) this.onStatusChange(status);
            }
        }, interval);
    }

    async getSessionStatus(): Promise<SessionStatus | null> {
        if (!this.session) return null;
        try {
            const response = await fetch(`${API_BASE}/api/webrtc/session/${this.session.sessionId}`);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async setTask(task: 'rubbing' | 'acid' | 'done'): Promise<boolean> {
        if (!this.session) return false;

        // For WebSocket mode, send via WebSocket
        if (this.session.mode === 'websocket' && this.session.websocket) {
            this.session.websocket.send(JSON.stringify({ action: 'set_task', task }));
            return true;
        }

        // For WebRTC mode, use REST API
        try {
            const response = await fetch(
                `${API_BASE}/api/webrtc/session/${this.session.sessionId}/task`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task })
                }
            );
            return response.ok;
        } catch {
            return false;
        }
    }

    async reset(): Promise<boolean> {
        if (!this.session) return false;

        if (this.session.mode === 'websocket' && this.session.websocket) {
            this.session.websocket.send(JSON.stringify({ action: 'reset' }));
            return true;
        }

        try {
            const response = await fetch(
                `${API_BASE}/api/webrtc/session/${this.session.sessionId}/reset`,
                { method: 'POST' }
            );
            return response.ok;
        } catch {
            return false;
        }
    }

    async disconnect(): Promise<void> {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = null;
        }

        if (this.frameInterval) {
            clearInterval(this.frameInterval);
            this.frameInterval = null;
        }

        if (!this.session) return;

        // Guard against multiple disconnect calls
        const sessionToCleanup = this.session;
        this.session = null; // Clear immediately to prevent re-entry

        // Store session ID before clearing session
        const sessionId = sessionToCleanup.sessionId;

        // Try to delete session on backend (ignore errors)
        try {
            await fetch(`${API_BASE}/api/webrtc/session/${sessionId}`, { method: 'DELETE' });
        } catch {
            // Ignore - session may already be gone
        }

        // Stop local stream tracks
        if (sessionToCleanup.localStream) {
            try {
                sessionToCleanup.localStream.getTracks().forEach(track => track.stop());
            } catch {
                // Ignore
            }
        }

        // Close websocket connection
        if (sessionToCleanup.websocket) {
            try {
                sessionToCleanup.websocket.close();
            } catch {
                // Ignore
            }
        }

        // Close peer connection
        if (sessionToCleanup.peerConnection) {
            try {
                sessionToCleanup.peerConnection.close();
            } catch {
                // Ignore
            }
        }

        this.videoElement = null;
        this.canvasElement = null;
        console.log('🔌 Disconnected');
    }

    setOnRemoteStream(callback: (stream: MediaStream) => void) {
        this.onRemoteStream = callback;
    }

    setOnAnnotatedFrame(callback: (frame: string) => void) {
        this.onAnnotatedFrame = callback;
    }

    setOnStatusChange(callback: (status: SessionStatus) => void) {
        this.onStatusChange = callback;
    }

    setOnConnectionStateChange(callback: (state: string) => void) {
        this.onConnectionStateChange = callback;
    }

    getSession(): WebRTCSession | null {
        return this.session;
    }

    isConnected(): boolean {
        if (!this.session) return false;
        if (this.session.mode === 'websocket') {
            return this.session.websocket?.readyState === WebSocket.OPEN;
        }
        return this.session.peerConnection?.connectionState === 'connected';
    }

    getMode(): 'webrtc' | 'websocket' | null {
        return this.session?.mode || null;
    }
}

// Singleton instance
export const webrtcService = new WebRTCService();
