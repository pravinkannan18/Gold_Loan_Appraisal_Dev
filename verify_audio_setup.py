#!/usr/bin/env python3
"""
Audio Integration Setup Verification Script
Run this to verify all audio components are properly installed
"""

import os
import sys
from pathlib import Path

def check_files():
    """Verify all required files exist"""
    
    print("\n" + "="*70)
    print("🎵 AUDIO INTEGRATION - SETUP VERIFICATION")
    print("="*70)
    
    base_dir = Path(__file__).parent
    
    # Backend files to check
    backend_files = [
        "backend/services/audio_service.py",
        "backend/routers/audio.py", 
        "backend/schemas/audio.py",
    ]
    
    # Documentation files to check
    doc_files = [
        "README_AUDIO.md",
        "INDEX.md",
        "AUDIO_SETUP_COMPLETE.md",
        "AUDIO_INTEGRATION_GUIDE.md",
        "AUDIO_COMPONENTS.md",
        "AUDIO_MODEL_SETUP.md",
        "AUDIO_ARCHITECTURE.md",
    ]
    
    print("\n✅ BACKEND FILES")
    print("-" * 70)
    backend_ok = True
    for file in backend_files:
        path = base_dir / file
        exists = path.exists()
        status = "✅" if exists else "❌"
        print(f"{status} {file}")
        if not exists:
            backend_ok = False
    
    print("\n📖 DOCUMENTATION FILES")
    print("-" * 70)
    doc_ok = True
    for file in doc_files:
        path = base_dir / file
        exists = path.exists()
        status = "✅" if exists else "❌"
        print(f"{status} {file}")
        if not exists:
            doc_ok = False
    
    print("\n📁 MODEL FOLDER")
    print("-" * 70)
    ml_models_dir = base_dir / "backend" / "ml_models"
    if ml_models_dir.exists():
        print(f"✅ Folder exists: {ml_models_dir}")
        model_files = list(ml_models_dir.glob("*.pth"))
        if model_files:
            print(f"✅ Found {len(model_files)} model file(s):")
            for model in model_files:
                size_mb = model.stat().st_size / (1024 * 1024)
                print(f"   - {model.name} ({size_mb:.1f} MB)")
        else:
            print("⚠️  No .pth files found in ml_models folder")
            print("   📌 ACTION: Upload your audio_model.pth file")
    else:
        print(f"✅ Creating folder: {ml_models_dir}")
        ml_models_dir.mkdir(parents=True, exist_ok=True)
    
    print("\n🔧 MAIN.PY INTEGRATION")
    print("-" * 70)
    main_file = base_dir / "backend" / "main.py"
    if main_file.exists():
        content = main_file.read_text()
        checks = {
            "import audio": "from routers import" in content and "audio" in content,
            "initialize_audio_service": "initialize_audio_service" in content,
            "include_router(audio": "include_router(audio" in content,
        }
        
        all_ok = True
        for check, result in checks.items():
            status = "✅" if result else "❌"
            print(f"{status} {check}")
            if not result:
                all_ok = False
        
        if not all_ok:
            print("\n⚠️  Some main.py integrations are missing!")
    
    print("\n" + "="*70)
    print("VERIFICATION SUMMARY")
    print("="*70)
    
    if backend_ok:
        print("✅ Backend files: COMPLETE")
    else:
        print("❌ Backend files: MISSING SOME FILES")
    
    if doc_ok:
        print("✅ Documentation: COMPLETE")
    else:
        print("❌ Documentation: MISSING SOME FILES")
    
    ml_model_exists = any((base_dir / "backend" / "ml_models").glob("*.pth"))
    if ml_model_exists:
        print("✅ Model file: UPLOADED")
    else:
        print("⚠️  Model file: NOT UPLOADED (required for operation)")
    
    print("\n" + "="*70)
    print("NEXT STEPS")
    print("="*70)
    print("""
1. Upload your trained audio model:
   → Copy your .pth file to: backend/ml_models/audio_model.pth

2. Start the backend server:
   → cd backend
   → python main.py

3. Verify the service is running:
   → curl http://localhost:8000/api/audio/health
   → Should return: {"status": "healthy", "service_available": true}

4. Implement frontend:
   → See AUDIO_COMPONENTS.md for React components
   → See AUDIO_INTEGRATION_GUIDE.md for integration steps

5. Test the complete workflow:
   → Record audio from microphone
   → Send to backend for inference
   → Display purity test results
    """)
    
    print("="*70)
    print("DOCUMENTATION QUICK LINKS")
    print("="*70)
    print("""
For Quick Start:          → README_AUDIO.md
For Implementation:       → INDEX.md (this tells you where to look)
For Frontend Code:        → AUDIO_COMPONENTS.md
For Integration Guide:    → AUDIO_INTEGRATION_GUIDE.md
For Model Setup:          → AUDIO_MODEL_SETUP.md
For Architecture:         → AUDIO_ARCHITECTURE.md
For Complete Summary:     → AUDIO_SETUP_COMPLETE.md
    """)
    
    print("="*70)
    if backend_ok and doc_ok:
        print("✅ SETUP COMPLETE - Ready for model upload and testing!")
    else:
        print("⚠️  Some components are missing. Check messages above.")
    print("="*70 + "\n")

if __name__ == "__main__":
    check_files()
