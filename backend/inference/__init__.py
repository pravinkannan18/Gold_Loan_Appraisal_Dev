"""Inference module for AI/ML model management and video processing"""
from .inference_worker import InferenceWorker
from .model_manager import get_model_manager

__all__ = ['InferenceWorker', 'get_model_manager']
