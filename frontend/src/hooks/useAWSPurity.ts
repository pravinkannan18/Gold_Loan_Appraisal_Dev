/**
 * AWS Purity Testing Hook
 * Camera runs on browser, YOLO runs on AWS GPU
 * Uses WebSocket for bidirectional frame streaming
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_URL = BASE_URL.replace('http', 'ws');

export interface PurityStatus {
  task: 'rubbing' | 'acid' | 'done';
  rubbing_detected: boolean;
  acid_detected: boolean;
  message: string;
}

export interface AWSPurityState {
  connected: boolean;
  streaming: boolean;
  sessionId: string | null;
  annotatedFrame: string | null;
  status: PurityStatus | null;
  fps: number;
  processMs: number;
  error: string | null;
}

export function useAWSPurity() {
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  
  const [state, setState] = useState<AWSPurityState>({
    connected: false,
    streaming: false,
    sessionId: null,
    annotatedFrame: null,
    status: null,
    fps: 0,
    processMs: 0,
    error: null,
  });

  // Generate session ID
  const generateSessionId = () => {
    return Math.random().toString(36).substring(2, 10);
  };

  // Connect to WebSocket
  const connect = useCallback((sessionId?: string) => {
    const sid = sessionId || generateSessionId();
    setState(prev => ({ ...prev, sessionId: sid }));
    
    console.log(`🔌 Connecting to AWS purity WebSocket (session: ${sid})...`);
    const ws = new WebSocket(`${WS_URL}/api/purity/aws/stream/${sid}`);
    
    ws.onopen = () => {
      console.log('✅ AWS WebSocket connected');
      setState(prev => ({ ...prev, connected: true, error: null }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'frame') {
          setState(prev => ({
            ...prev,
            annotatedFrame: `data:image/jpeg;base64,${data.frame}`,
            status: data.status,
            fps: data.fps || 0,
            processMs: data.process_ms || 0,
          }));
        } else if (data.type === 'error') {
          console.error('AWS error:', data.message);
          setState(prev => ({ ...prev, error: data.message }));
        } else if (data.type === 'control') {
          console.log('Control:', data.message);
        }
      } catch (e) {
        console.error('WebSocket parse error:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setState(prev => ({ ...prev, error: 'WebSocket connection error' }));
    };

    ws.onclose = () => {
      console.log('🔌 AWS WebSocket disconnected');
      setState(prev => ({ 
        ...prev, 
        connected: false, 
        streaming: false,
      }));
    };

    wsRef.current = ws;
    return sid;
  }, []);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    stopStreaming();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(prev => ({ 
      ...prev, 
      connected: false, 
      streaming: false,
      annotatedFrame: null 
    }));
  }, []);

  // Start browser camera and streaming
  const startStreaming = useCallback(async (deviceId?: string) => {
    try {
      // Get camera stream
      const constraints: MediaStreamConstraints = {
        video: deviceId 
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { width: 640, height: 480 }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;
      
      // Create canvas for frame capture
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvasRef.current = canvas;
      
      setState(prev => ({ ...prev, streaming: true }));
      
      // Start sending frames
      const sendFrame = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }
        if (!videoRef.current || !canvasRef.current) {
          return;
        }
        
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(videoRef.current, 0, 0, 640, 480);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.7);
        
        wsRef.current.send(JSON.stringify({
          action: 'frame',
          data: dataUrl
        }));
      };
      
      // Send frames at ~20 FPS (50ms interval)
      frameIntervalRef.current = window.setInterval(sendFrame, 50);
      
      console.log('📸 Browser camera streaming started');
      
    } catch (error) {
      console.error('Failed to start camera:', error);
      setState(prev => ({ ...prev, error: 'Failed to access camera' }));
    }
  }, []);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    videoRef.current = null;
    canvasRef.current = null;
    
    setState(prev => ({ 
      ...prev, 
      streaming: false,
      annotatedFrame: null 
    }));
    
    console.log('📸 Browser camera streaming stopped');
  }, []);

  // Reset detection state
  const reset = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'reset' }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    startStreaming,
    stopStreaming,
    reset,
  };
}

// HTTP API functions
export async function getAWSServiceStatus() {
  const response = await fetch(`${BASE_URL}/api/purity/aws/status`);
  return response.json();
}

export async function createSession() {
  const response = await fetch(`${BASE_URL}/api/purity/aws/session/create`, {
    method: 'POST',
  });
  return response.json();
}

export async function getAvailableCameras(): Promise<MediaDeviceInfo[]> {
  try {
    // Need to request permission first to get labels
    await navigator.mediaDevices.getUserMedia({ video: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch {
    return [];
  }
}
