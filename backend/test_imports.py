#!/usr/bin/env python
"""Test script to verify all imports work correctly"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

print("Testing imports...")

try:
    print("1. Testing inference imports...")
    from inference.inference_worker import InferenceWorker
    print("   ✅ InferenceWorker imported successfully")
    
    print("2. Testing webrtc imports...")
    from webrtc.signaling import webrtc_manager
    print("   ✅ webrtc_manager imported successfully")
    
    print("3. Testing video_processor import...")
    from webrtc.video_processor import VideoTransformTrack
    print("   ✅ VideoTransformTrack imported successfully")
    
    print("\n✅ All imports successful!")
    
except Exception as e:
    print(f"\n❌ Import failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
