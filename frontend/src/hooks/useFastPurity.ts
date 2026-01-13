/**
 * Fast Purity Testing Hook
 * Uses WebSocket for real-time YOLO predictions from backend camera
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

export interface FastPurityFrame {
  frame: string;
  status: PurityStatus;
  fps: number;
  process_ms: number;
}

export interface FastPurityState {
  connected: boolean;
  running: boolean;
  frame: string | null;
  status: PurityStatus | null;
  fps: number;
  processMs: number;
  error: string | null;
}

export function useFastPurity() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  const [state, setState] = useState<FastPurityState>({
    connected: false,
    running: false,
    frame: null,
    status: null,
    fps: 0,
    processMs: 0,
    error: null,
  });

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log('🔌 Connecting to fast purity WebSocket...');
    const ws = new WebSocket(`${WS_URL}/api/purity/fast/stream`);
    
    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      setState(prev => ({ ...prev, connected: true, error: null }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'frame') {
          setState(prev => ({
            ...prev,
            frame: `data:image/jpeg;base64,${data.frame}`,
            status: data.status,
            fps: data.fps || 0,
            processMs: data.process_ms || 0,
            running: true,
          }));
        } else if (data.type === 'status') {
          setState(prev => ({
            ...prev,
            status: data.status,
            running: data.status?.running || false,
          }));
        } else if (data.type === 'control') {
          console.log('Control response:', data.result);
          if (data.result?.success === false) {
            setState(prev => ({ ...prev, error: data.result.error }));
          }
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
      console.log('🔌 WebSocket disconnected');
      setState(prev => ({ 
        ...prev, 
        connected: false, 
        running: false,
        frame: null 
      }));
      
      // Auto-reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (wsRef.current === ws) {
          connect();
        }
      }, 2000);
    };

    wsRef.current = ws;
  }, []);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(prev => ({ 
      ...prev, 
      connected: false, 
      running: false,
      frame: null 
    }));
  }, []);

  // Send command to WebSocket
  const sendCommand = useCallback((action: string, params: Record<string, unknown> = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, ...params }));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  // Start camera and analysis
  const start = useCallback((cameraIndex: number = 0) => {
    sendCommand('start', { camera_index: cameraIndex });
  }, [sendCommand]);

  // Stop camera and analysis
  const stop = useCallback(() => {
    sendCommand('stop');
    setState(prev => ({ ...prev, running: false, frame: null }));
  }, [sendCommand]);

  // Reset detection state
  const reset = useCallback(() => {
    sendCommand('reset');
  }, [sendCommand]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    start,
    stop,
    reset,
  };
}

// HTTP API for status (fallback/initial check)
export async function getFastPurityStatus() {
  const response = await fetch(`${BASE_URL}/api/purity/fast/status`);
  return response.json();
}

export async function getAvailableCameras() {
  const response = await fetch(`${BASE_URL}/api/purity/fast/cameras`);
  return response.json();
}

export async function startFastPurity(cameraIndex: number = 0) {
  const response = await fetch(`${BASE_URL}/api/purity/fast/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_index: cameraIndex }),
  });
  return response.json();
}

export async function stopFastPurity() {
  const response = await fetch(`${BASE_URL}/api/purity/fast/stop`, {
    method: 'POST',
  });
  return response.json();
}
