import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Gem, Play, Square, AlertCircle, ScanLine, RefreshCw, Wifi, WifiOff, Video, VideoOff, Loader2 } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { showToast } from '../lib/utils';
import { Button } from '../components/ui/button';
import { PageCameraSelector } from '../components/ui/page-camera-selector';
import { useCameraDetection } from '../hooks/useCameraDetection';
import { webrtcService, type SessionStatus } from '../services/webrtc';

/**
 * Interface for tracking test results per jewelry item
 */
interface ItemTestResult {
    itemNumber: number;
    rubbingCompleted: boolean;
    acidCompleted: boolean;
    timestamp: string;
}

/**
 * WebRTC-based Purity Testing Page
 * Uses WebRTC for ultra-low latency video streaming with backend AI inference
 */
export function WebRTCPurityTesting() {
    const navigate = useNavigate();

    // Camera state
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [showCameraSelection, setShowCameraSelection] = useState(true);

    // WebRTC state
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionState, setConnectionState] = useState<string>('disconnected');
    const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);

    // Multi-item state
    const [totalItemCount, setTotalItemCount] = useState(0);
    const [currentItemIndex, setCurrentItemIndex] = useState(0); // 0-based index
    const [itemTestResults, setItemTestResults] = useState<ItemTestResult[]>([]);

    // Analysis state (for current item)
    const [rubbingCompleted, setRubbingCompleted] = useState(false);
    const [acidCompleted, setAcidCompleted] = useState(false);
    const [currentTask, setCurrentTask] = useState<'rubbing' | 'acid' | 'done'>('rubbing');

    // Video refs
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    // Annotated frame for WebSocket mode
    const [annotatedFrame, setAnnotatedFrame] = useState<string | null>(null);
    const [connectionMode, setConnectionMode] = useState<'webrtc' | 'websocket' | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    // Camera detection hook
    const {
        cameras,
        permission,
        isLoading: cameraLoading,
        error: cameraError,
        enumerateDevices,
        requestPermission,
    } = useCameraDetection();

    // Auto-request camera permission
    useEffect(() => {
        if (permission.status === 'prompt') {
            requestPermission();
        }
    }, [permission.status, requestPermission]);

    // Load jewelry items from session API on mount
    useEffect(() => {
        const loadJewelleryItems = async () => {
            try {
                const sessionId = localStorage.getItem('appraisal_session_id');

                if (!sessionId) {
                    console.warn('No session ID found');
                    showToast('No session found. Please start from the beginning.', 'error');
                    return;
                }

                console.log('📦 Loading jewelry items from session:', sessionId);
                const response = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/jewellery-items`);

                if (!response.ok) {
                    throw new Error('Failed to load jewelry items');
                }

                const data = await response.json();
                const count = data.total_items || 0;
                setTotalItemCount(count);
                console.log(`📦 Loaded ${count} jewelry items for purity testing`);

                // Initialize test results array
                const initialResults: ItemTestResult[] = Array.from({ length: count }, (_, i) => ({
                    itemNumber: i + 1,
                    rubbingCompleted: false,
                    acidCompleted: false,
                    timestamp: ''
                }));
                setItemTestResults(initialResults);
            } catch (error) {
                console.error('Failed to load jewelry items:', error);

                // Fallback to localStorage for backward compatibility
                const totalItemsStr = localStorage.getItem('totalItems');
                if (totalItemsStr) {
                    const count = parseInt(totalItemsStr, 10) || 0;
                    setTotalItemCount(count);
                    const initialResults: ItemTestResult[] = Array.from({ length: count }, (_, i) => ({
                        itemNumber: i + 1,
                        rubbingCompleted: false,
                        acidCompleted: false,
                        timestamp: ''
                    }));
                    setItemTestResults(initialResults);
                    console.log(`📦 Loaded ${count} items from localStorage fallback`);
                } else {
                    showToast('Failed to load jewelry items', 'error');
                }
            }
        };

        loadJewelleryItems();
    }, []);

    // Handle remote stream from WebRTC
    const handleRemoteStream = useCallback((stream: MediaStream) => {
        console.log('🎬 Received remote stream with', stream.getTracks().length, 'tracks');
        setRemoteStream(stream);
    }, []);

    // Apply remote stream to video element when available
    useEffect(() => {
        if (remoteStream && remoteVideoRef.current) {
            console.log('🎬 Applying remote stream to video element');
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

    // Handle session status updates
    const handleStatusChange = useCallback((status: SessionStatus) => {
        console.log('📊 Status update:', status);
        setSessionStatus(status);

        // Update local state from session
        if (status.detection_status) {
            // Rubbing detected - backend auto-switches to acid task
            if (status.detection_status.rubbing_detected) {
                setRubbingCompleted(true);
            }

            // Acid detected - ONLY accept if rubbing is already complete
            // This prevents skipping rubbing test
            if (status.detection_status.acid_detected) {
                setRubbingCompleted((prevRubbing) => {
                    // Only mark acid complete if rubbing was already done
                    if (prevRubbing) {
                        setAcidCompleted(true);
                    } else {
                        console.warn('⚠️ Acid detected but rubbing not complete - ignoring');
                    }
                    return prevRubbing;
                });
            }
        }

        // Update current task from backend (backend handles auto-switching)
        // But only accept 'acid' or 'done' task if rubbing is complete
        console.log('📋 Task update:', status.current_task);
        setRubbingCompleted((prevRubbing) => {
            if (status.current_task === 'acid' || status.current_task === 'done') {
                if (!prevRubbing) {
                    console.warn('⚠️ Task trying to advance but rubbing not complete - staying on rubbing');
                    setCurrentTask('rubbing');
                } else {
                    setCurrentTask(status.current_task);
                }
            } else {
                setCurrentTask(status.current_task);
            }
            return prevRubbing;
        });
    }, []); // No dependencies - uses setters which are stable

    // Track if we've already handled completion for the current item
    const completionHandledRef = useRef<number | null>(null);

    // Auto-navigate or advance to next item when both tests complete
    useEffect(() => {
        // Only proceed if we haven't handled this item yet
        if (rubbingCompleted && acidCompleted && currentTask === 'done' && completionHandledRef.current !== currentItemIndex) {
            console.log(`🎉 Item ${currentItemIndex + 1} tests complete!`);

            // Mark this item as handled to prevent loops
            completionHandledRef.current = currentItemIndex;

            // Save current item results
            setItemTestResults(prevResults => {
                const updatedResults = [...prevResults];
                if (updatedResults[currentItemIndex]) {
                    updatedResults[currentItemIndex] = {
                        itemNumber: currentItemIndex + 1,
                        rubbingCompleted: true,
                        acidCompleted: true,
                        timestamp: new Date().toISOString()
                    };
                }

                // Perform navigation logic with the UPDATED results
                // We do this inside the setter to ensure we have latest state, 
                // OR we can just use the local 'updatedResults' variable since we are in the effect scope

                // NOTE: We need to handle the side effects (API calls, navigation) 
                // outside the state setter usually, but here we need the updated data.
                // Better approach: Calculate updated results, set state, THEN use the calculated results for API/Nav.

                return updatedResults;
            });

            // Re-calculate updated results locally for API/Navigation usage
            // (Since state update is async, we can't read 'itemTestResults' immediately after set)
            const updatedResultsSnapshot = [...itemTestResults];
            if (updatedResultsSnapshot[currentItemIndex]) {
                updatedResultsSnapshot[currentItemIndex] = {
                    itemNumber: currentItemIndex + 1,
                    rubbingCompleted: true,
                    acidCompleted: true,
                    timestamp: new Date().toISOString()
                };
            }

            // Check if this is the last item
            if (currentItemIndex + 1 >= totalItemCount) {
                console.log('🎊 All items complete! Saving and navigating to summary...');
                showToast('🎊 All purity testing complete! Saving data...', 'success');

                // Save all results to localStorage (backup)
                localStorage.setItem('purityTestResults', JSON.stringify(updatedResultsSnapshot));

                // Save to API
                const saveToApi = async () => {
                    try {
                        const sessionId = localStorage.getItem('appraisal_session_id');
                        if (sessionId) {
                            const testResults = {
                                items: updatedResultsSnapshot.map(item => ({
                                    itemNumber: item.itemNumber,
                                    rubbingCompleted: item.rubbingCompleted,
                                    acidCompleted: item.acidCompleted,
                                    timestamp: item.timestamp
                                })),
                                total_items: totalItemCount,
                                completed_at: new Date().toISOString()
                            };

                            await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/purity-test`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(testResults)
                            });
                            console.log('✅ Purity results saved to API');
                        }
                    } catch (error) {
                        console.error('Failed to save purity results to API:', error);
                        // We still navigate since we have local storage backup
                    }

                    // Disconnect WebRTC and navigate
                    webrtcService.disconnect();
                    navigate('/appraisal-summary');
                };

                // Execute save and navigate
                saveToApi();

            } else {
                // Move to next item
                const nextItemIndex = currentItemIndex + 1;
                console.log(`➡️ Advancing to item ${nextItemIndex + 1} of ${totalItemCount}`);
                showToast(`✅ Item ${currentItemIndex + 1} complete! Starting Item ${nextItemIndex + 1}...`, 'success');

                // Reset session for next item after a short delay
                setTimeout(async () => {
                    const resetSuccess = await webrtcService.reset();
                    if (resetSuccess) {
                        setCurrentItemIndex(nextItemIndex);
                        setRubbingCompleted(false);
                        setAcidCompleted(false);
                        setCurrentTask('rubbing');
                        setRubbingToastShown(false);
                        setAcidToastShown(false);
                        // Reset handled ref effectively by changing index
                    } else {
                        showToast('Failed to reset session. Please disconnect and reconnect.', 'error');
                    }
                }, 1500);
            }
        }
    }, [rubbingCompleted, acidCompleted, currentTask, currentItemIndex, totalItemCount, itemTestResults, navigate]);

    // Show toasts when tests complete
    const [rubbingToastShown, setRubbingToastShown] = useState(false);
    const [acidToastShown, setAcidToastShown] = useState(false);

    useEffect(() => {
        if (rubbingCompleted && !rubbingToastShown) {
            showToast('✅ Rubbing Test Complete! Starting Acid Test...', 'success');
            setRubbingToastShown(true);
        }
    }, [rubbingCompleted, rubbingToastShown]);

    useEffect(() => {
        if (acidCompleted && !acidToastShown) {
            showToast('✅ Acid Test Complete! Analysis Done!', 'success');
            setAcidToastShown(true);
        }
    }, [acidCompleted, acidToastShown]);

    // Handle annotated frames (WebSocket mode)
    const handleAnnotatedFrame = useCallback((frame: string) => {
        console.log('🖼️ Received annotated frame, length:', frame?.length);
        setAnnotatedFrame(frame);
    }, []);

    // Handle connection state changes
    const handleConnectionStateChange = useCallback((state: string) => {
        console.log('🔗 Connection state changed:', state);
        setConnectionState(state);
        setIsConnected(state === 'connected');

        // Update mode
        const mode = webrtcService.getMode();
        if (mode) setConnectionMode(mode);

        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            console.warn('⚠️ Connection lost or closed:', state);
            showToast('WebRTC connection lost', 'error');
        }
    }, []);

    // Setup WebRTC callbacks - only once on mount
    useEffect(() => {
        webrtcService.setOnRemoteStream(handleRemoteStream);
        webrtcService.setOnAnnotatedFrame(handleAnnotatedFrame);
        webrtcService.setOnStatusChange(handleStatusChange);
        webrtcService.setOnConnectionStateChange(handleConnectionStateChange);
        // NOTE: No cleanup disconnect here - it was causing premature disconnection
        // Disconnect is handled explicitly by user action or auto-navigation
    }, [handleRemoteStream, handleAnnotatedFrame, handleStatusChange, handleConnectionStateChange]);

    // Cleanup on unmount only
    useEffect(() => {
        return () => {
            console.log('🧹 Component unmounting - disconnecting WebRTC');
            webrtcService.disconnect();
        };
    }, []); // Empty deps - only runs on unmount

    // Connect to WebRTC
    const connectWebRTC = async () => {
        if (!selectedCameraId) {
            showToast('Please select a camera first', 'error');
            return;
        }

        setIsConnecting(true);
        try {
            const session = await webrtcService.connect(
                localVideoRef.current || undefined,
                selectedCameraId
            );

            if (session) {
                setIsConnected(true);
                setConnectionMode(session.mode);
                showToast(`✅ Connected (${session.mode} mode)!`, 'success');
            }
        } catch (error) {
            console.error('WebRTC connection failed:', error);
            showToast('Failed to connect WebRTC', 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    // Disconnect WebRTC
    const disconnectWebRTC = async () => {
        await webrtcService.disconnect();
        setIsConnected(false);
        setSessionStatus(null);
        showToast('WebRTC disconnected', 'info');
    };

    // Toggle connection
    const toggleConnection = async () => {
        if (isConnected) {
            await disconnectWebRTC();
        } else {
            await connectWebRTC();
        }
    };

    // Switch task (rubbing → acid → done)
    const switchTask = async (task: 'rubbing' | 'acid' | 'done') => {
        const success = await webrtcService.setTask(task);
        if (success) {
            setCurrentTask(task);
            showToast(`Switched to ${task} mode`, 'success');
        } else {
            showToast('Failed to switch task', 'error');
        }
    };

    // Reset session
    const resetSession = async () => {
        const success = await webrtcService.reset();
        if (success) {
            setRubbingCompleted(false);
            setAcidCompleted(false);
            setCurrentTask('rubbing');
            showToast('Session reset', 'info');
        }
    };

    // Handle next step
    const handleNext = async () => {
        // Check if ALL items have completed their tests
        const allComplete = totalItemCount > 0 && itemTestResults.every(i => i.rubbingCompleted && i.acidCompleted);

        if (!allComplete) {
            const incompleteCount = itemTestResults.filter(i => !i.rubbingCompleted || !i.acidCompleted).length;
            showToast(`Please complete all purity tests. ${incompleteCount} item(s) remaining.`, 'error');
            return;
        }

        try {
            // Save to session API
            const sessionId = localStorage.getItem('appraisal_session_id');
            if (sessionId) {
                const testResults = {
                    items: itemTestResults.map(item => ({
                        itemNumber: item.itemNumber,
                        rubbingCompleted: item.rubbingCompleted,
                        acidCompleted: item.acidCompleted,
                        timestamp: item.timestamp
                    })),
                    total_items: totalItemCount,
                    completed_at: new Date().toISOString()
                };

                const response = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/purity-test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testResults)
                });

                if (!response.ok) {
                    console.error('Failed to save purity results to session');
                }
            }
        } catch (error) {
            console.error('Error saving purity results:', error);
        }

        // Disconnect and navigate
        disconnectWebRTC();
        showToast('🎉 All purity tests completed! Proceeding to summary...', 'success');
        navigate('/appraisal-summary');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
            <StepIndicator currentStep={4} />

            <div className="w-full px-6 py-8">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 rounded-2xl p-6 mb-6 shadow-2xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                                <Gem className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white">Purity Testing</h1>
                                <p className="text-emerald-100">Real-time AI-powered gold analysis</p>
                                {totalItemCount > 0 && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="px-3 py-1 bg-white/20 rounded-lg backdrop-blur-sm border border-white/30">
                                            <span className="text-sm font-bold text-white">
                                                Item {currentItemIndex + 1} of {totalItemCount}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Connection Status */}
                        <div className="flex items-center gap-4">
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isConnected
                                ? 'bg-green-500/20 text-green-200 border border-green-400/30'
                                : 'bg-red-500/20 text-red-200 border border-red-400/30'
                                }`}>
                                {isConnected ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
                                <span className="font-medium">{connectionState}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Camera Selection */}
                {showCameraSelection && (
                    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-800 flex items-center">
                                <ScanLine className="w-6 h-6 mr-2 text-emerald-500" />
                                Camera Selection
                            </h3>
                            <div className="flex gap-2">
                                <Button onClick={enumerateDevices} disabled={cameraLoading} variant="outline" size="sm">
                                    {cameraLoading ? (
                                        <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Scanning...</>
                                    ) : (
                                        <><RefreshCw className="w-4 h-4 mr-2" /> Refresh</>
                                    )}
                                </Button>
                                <Button onClick={() => setShowCameraSelection(false)} variant="outline" size="sm">
                                    ✕ Close
                                </Button>
                            </div>
                        </div>

                        {permission.status === 'denied' && (
                            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                                    <p className="text-red-600">Camera permission denied. Please enable in browser settings.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-center">
                            <PageCameraSelector
                                context="purity-testing"
                                label="📹 Select Camera for Analysis"
                                onCameraSelected={(camera) => setSelectedCameraId(camera?.deviceId || '')}
                                className="w-full max-w-md"
                            />
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Video Streams */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Processed Video (from backend) */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-200 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-lg font-bold text-gray-800 flex items-center">
                                    <Video className="w-5 h-5 mr-2 text-emerald-500" />
                                    AI-Annotated Stream
                                </h4>
                                <div className={`px-3 py-1 rounded-full text-sm font-medium ${isConnected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                    {isConnected ? '🔴 LIVE' : 'Offline'}
                                </div>
                            </div>

                            <div className="relative aspect-video bg-gray-100 rounded-xl overflow-hidden border-2 border-emerald-200">
                                {/* Remote video stream (always rendered for ref, visible in WebRTC mode) */}
                                <video
                                    ref={remoteVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={`w-full h-full object-cover ${connectionMode !== 'webrtc' ? 'hidden' : ''}`}
                                />

                                {/* WebSocket mode: show annotated frame as image */}
                                {connectionMode === 'websocket' && annotatedFrame && (
                                    <img
                                        src={annotatedFrame}
                                        alt="AI Analysis"
                                        className="w-full h-full object-cover"
                                    />
                                )}

                                {/* WebSocket mode: show processing indicator when no frame but connected */}
                                {connectionMode === 'websocket' && !annotatedFrame && isConnected && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                                        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
                                        <p className="text-gray-500 text-lg">Processing frames...</p>
                                    </div>
                                )}

                                {!isConnected && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                                        <VideoOff className="w-16 h-16 text-gray-400 mb-4" />
                                        <p className="text-gray-500 text-lg">Connect to start analysis</p>
                                    </div>
                                )}

                                {/* Mode indicator */}
                                {isConnected && connectionMode && (
                                    <div className="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-xs text-white">
                                        {connectionMode.toUpperCase()} mode
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Local Video Preview (small) */}
                        <div className="bg-white/60 rounded-xl p-3 border border-gray-200 shadow-sm">
                            <h5 className="text-sm font-medium text-gray-600 mb-2">Local Camera Preview</h5>
                            <div className="relative aspect-video max-h-40 bg-gray-100 rounded-lg overflow-hidden">
                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Controls Panel */}
                    <div className="space-y-4">
                        {/* Connection Controls */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-200 shadow-sm">
                            <h4 className="text-lg font-bold text-gray-800 mb-4">Connection</h4>

                            <Button
                                onClick={toggleConnection}
                                disabled={!selectedCameraId || isConnecting}
                                className={`w-full py-6 text-lg font-bold ${isConnected
                                    ? 'bg-red-500 hover:bg-red-600'
                                    : 'bg-emerald-500 hover:bg-emerald-600'
                                    }`}
                            >
                                {isConnecting ? (
                                    <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Connecting...</>
                                ) : isConnected ? (
                                    <><Square className="w-5 h-5 mr-2" /> Disconnect</>
                                ) : (
                                    <><Play className="w-5 h-5 mr-2" /> Connect & Analyze</>
                                )}
                            </Button>

                            {isConnected && (
                                <Button
                                    onClick={resetSession}
                                    variant="outline"
                                    className="w-full mt-2 border-gray-300 text-gray-600"
                                >
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Reset Session
                                </Button>
                            )}
                        </div>

                        {/* Task Switcher */}
                        {isConnected && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-200 shadow-sm">
                                <h4 className="text-lg font-bold text-gray-800 mb-4">Current Task</h4>

                                <div className="grid grid-cols-3 gap-2">
                                    {(['rubbing', 'acid', 'done'] as const).map((task) => (
                                        <Button
                                            key={task}
                                            onClick={() => switchTask(task)}
                                            variant={currentTask === task ? 'default' : 'outline'}
                                            className={`capitalize ${currentTask === task
                                                ? 'bg-emerald-500 text-white'
                                                : 'border-gray-300 text-gray-600'
                                                }`}
                                        >
                                            {task}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Detection Status */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-200 shadow-sm">
                            <h4 className="text-lg font-bold text-gray-800 mb-4">Detection Status</h4>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <span className="text-gray-600">Rubbing Test</span>
                                    <span className={`font-bold ${rubbingCompleted ? 'text-green-500' : 'text-amber-500'}`}>
                                        {rubbingCompleted ? '✅ Detected' : '⏳ Pending'}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <span className="text-gray-600">Acid Test</span>
                                    <span className={`font-bold ${acidCompleted ? 'text-green-500' : 'text-amber-500'}`}>
                                        {acidCompleted ? '✅ Detected' : '⏳ Pending'}
                                    </span>
                                </div>

                                {sessionStatus?.detection_status?.gold_purity && (
                                    <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                                        <span className="text-amber-700">Gold Purity</span>
                                        <span className="font-bold text-amber-600">
                                            {sessionStatus.detection_status.gold_purity}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Multi-Item Test Sections */}
                        {totalItemCount > 0 && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-200 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="text-lg font-bold text-gray-800">Purity Tests</h4>
                                    <div className="text-sm font-medium text-gray-500">
                                        {itemTestResults.filter(i => i.rubbingCompleted && i.acidCompleted).length} / {totalItemCount} Complete
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                                    <div
                                        className="bg-gradient-to-r from-emerald-500 to-teal-500 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${(itemTestResults.filter(i => i.rubbingCompleted && i.acidCompleted).length / totalItemCount) * 100}%` }}
                                    />
                                </div>

                                <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                                    {itemTestResults.map((item, index) => {
                                        const isCurrentItem = index === currentItemIndex;
                                        const isComplete = item.rubbingCompleted && item.acidCompleted;
                                        const isPending = index > currentItemIndex;

                                        // For current item, use live state
                                        const showRubbingComplete = isCurrentItem ? rubbingCompleted : item.rubbingCompleted;
                                        const showAcidComplete = isCurrentItem ? acidCompleted : item.acidCompleted;

                                        return (
                                            <div
                                                key={item.itemNumber}
                                                className={`rounded-xl border-2 overflow-hidden transition-all duration-300 ${isCurrentItem
                                                    ? 'border-emerald-400 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-300/50'
                                                    : isComplete
                                                        ? 'border-green-300 bg-green-50/50'
                                                        : 'border-gray-200 bg-gray-50/50 opacity-60'
                                                    }`}
                                            >
                                                {/* Test Header */}
                                                <div className={`px-4 py-3 flex items-center justify-between ${isCurrentItem
                                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                                                    : isComplete
                                                        ? 'bg-green-100 text-green-800'
                                                        : 'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    <div className="flex items-center gap-3">
                                                        <span className={`text-lg font-bold ${isCurrentItem ? 'text-white' : ''}`}>
                                                            Test {item.itemNumber}
                                                        </span>
                                                        {isCurrentItem && (
                                                            <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-medium animate-pulse">
                                                                🔴 Testing Now
                                                            </span>
                                                        )}
                                                        {isComplete && !isCurrentItem && (
                                                            <span className="text-green-600">✅</span>
                                                        )}
                                                    </div>
                                                    {isPending && (
                                                        <span className="text-xs text-gray-400">Pending</span>
                                                    )}
                                                </div>

                                                {/* Test Details - Rubbing & Acid */}
                                                <div className="p-4 space-y-3">
                                                    {/* Rubbing Test */}
                                                    <div className={`flex items-center justify-between p-3 rounded-lg transition-all ${showRubbingComplete
                                                        ? 'bg-green-100 border border-green-300'
                                                        : isCurrentItem && currentTask === 'rubbing'
                                                            ? 'bg-amber-50 border-2 border-amber-400 shadow-md'
                                                            : 'bg-gray-100 border border-gray-200'
                                                        }`}>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${showRubbingComplete
                                                                ? 'bg-green-500 text-white'
                                                                : isCurrentItem && currentTask === 'rubbing'
                                                                    ? 'bg-amber-500 text-white animate-pulse'
                                                                    : 'bg-gray-300 text-gray-500'
                                                                }`}>
                                                                {showRubbingComplete ? '✓' : '1'}
                                                            </div>
                                                            <div>
                                                                <div className="font-semibold text-gray-800">Rubbing Test</div>
                                                                <div className="text-xs text-gray-500">Gold streak verification</div>
                                                            </div>
                                                        </div>
                                                        <span className={`font-bold text-sm ${showRubbingComplete
                                                            ? 'text-green-600'
                                                            : isCurrentItem && currentTask === 'rubbing'
                                                                ? 'text-amber-600'
                                                                : 'text-gray-400'
                                                            }`}>
                                                            {showRubbingComplete ? '✅ Complete' : isCurrentItem && currentTask === 'rubbing' ? '⏳ In Progress' : '○ Pending'}
                                                        </span>
                                                    </div>

                                                    {/* Acid Test */}
                                                    <div className={`flex items-center justify-between p-3 rounded-lg transition-all ${showAcidComplete
                                                        ? 'bg-green-100 border border-green-300'
                                                        : isCurrentItem && currentTask === 'acid'
                                                            ? 'bg-amber-50 border-2 border-amber-400 shadow-md'
                                                            : 'bg-gray-100 border border-gray-200'
                                                        }`}>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${showAcidComplete
                                                                ? 'bg-green-500 text-white'
                                                                : isCurrentItem && currentTask === 'acid'
                                                                    ? 'bg-amber-500 text-white animate-pulse'
                                                                    : 'bg-gray-300 text-gray-500'
                                                                }`}>
                                                                {showAcidComplete ? '✓' : '2'}
                                                            </div>
                                                            <div>
                                                                <div className="font-semibold text-gray-800">Acid Test</div>
                                                                <div className="text-xs text-gray-500">Purity confirmation</div>
                                                            </div>
                                                        </div>
                                                        <span className={`font-bold text-sm ${showAcidComplete
                                                            ? 'text-green-600'
                                                            : isCurrentItem && currentTask === 'acid'
                                                                ? 'text-amber-600'
                                                                : 'text-gray-400'
                                                            }`}>
                                                            {showAcidComplete ? '✅ Complete' : isCurrentItem && currentTask === 'acid' ? '⏳ In Progress' : '○ Pending'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* All Tests Complete Message */}
                                {itemTestResults.every(i => i.rubbingCompleted && i.acidCompleted) && (
                                    <div className="mt-4 p-4 bg-green-100 border-2 border-green-400 rounded-xl text-center">
                                        <div className="text-2xl mb-2">🎉</div>
                                        <div className="font-bold text-green-800">All Purity Tests Complete!</div>
                                        <div className="text-sm text-green-600">You can now proceed to the summary.</div>
                                    </div>
                                )}
                            </div>
                        )}


                        {/* Session Info */}
                        {connectionMode === 'webrtc' && isConnected && (
                            <div className="bg-blue-50 rounded-xl p-3 border border-blue-200 text-sm shadow-sm">
                                <div className="text-blue-700 font-medium mb-1">🎥 WebRTC Mode</div>
                                <div className="text-blue-600 text-xs">
                                    Watch the video stream for task status. Auto-switches: Rubbing → Acid → Done
                                </div>
                            </div>
                        )}

                        {sessionStatus && (
                            <div className="bg-white/60 rounded-xl p-3 border border-gray-200 text-sm shadow-sm">
                                <div className="text-gray-500 space-y-1">
                                    <div>Session: <span className="text-gray-700">{sessionStatus.session_id}</span></div>
                                    <div>Task: <span className="text-emerald-600">{sessionStatus.current_task}</span></div>
                                    <div>State: <span className="text-gray-700">{sessionStatus.connection_state}</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between items-center mt-8">
                    <Button onClick={() => navigate('/rbi-compliance')} variant="outline" className="border-gray-300 text-gray-600">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back
                    </Button>

                    {/* Show progress indicator in the middle */}
                    {totalItemCount > 0 && (
                        <div className="text-center">
                            <div className="text-sm text-gray-500">
                                Testing Progress
                            </div>
                            <div className="text-lg font-bold text-emerald-600">
                                {itemTestResults.filter(i => i.rubbingCompleted && i.acidCompleted).length} / {totalItemCount} Complete
                            </div>
                        </div>
                    )}

                    {/* Next Button - enabled only when ALL items are complete */}
                    {(() => {
                        const allComplete = totalItemCount > 0 && itemTestResults.every(i => i.rubbingCompleted && i.acidCompleted);
                        return (
                            <Button
                                onClick={handleNext}
                                disabled={!allComplete}
                                className={`px-8 py-6 text-lg font-bold transition-all duration-300 ${allComplete
                                    ? 'bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 hover:from-emerald-600 hover:via-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/30 animate-pulse'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    }`}
                            >
                                {allComplete ? (
                                    <>
                                        ✅ Complete - Go to Summary
                                        <ArrowRight className="w-5 h-5 ml-2" />
                                    </>
                                ) : (
                                    <>
                                        Complete All Tests to Continue
                                        <ArrowRight className="w-5 h-5 ml-2" />
                                    </>
                                )}
                            </Button>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}

export default WebRTCPurityTesting;
