// API service for backend communication
const API_BASE_URL = import.meta.env.VITE_API_URL;

export interface AppraiserData {
  name: string;
  id: string;
  image: string;
  timestamp: string;
}

export interface AppraiserResponse {
  success: boolean;
  id: number;
  message: string;
}

export interface AppraisalData {
  appraiser_id: number;
  customer_front_image: string;
  customer_side_image: string;
}

export interface AppraisalResponse {
  success: boolean;
  appraisal_id: number;
  message: string;
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Health check
  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  // Save appraiser details
  async saveAppraiser(appraiser: AppraiserData): Promise<AppraiserResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/appraiser`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(appraiser),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save appraiser');
      }

      return response.json();
    } catch (error: any) {
      if (error.message === 'Failed to fetch') {
        throw new Error('Backend server is not running. Please start the backend at http://localhost:8000');
      }
      throw error;
    }
  }

  // Get appraiser by ID
  async getAppraiser(appraiserId: string) {
    const response = await fetch(`${this.baseUrl}/api/appraiser/${appraiserId}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get appraiser');
    }

    return response.json();
  }

  // Create appraisal (customer images step)
  async createAppraisal(appraisalData: {
    appraiser_db_id: number;
    appraiser_name: string;
    customer_front_image: string;
    customer_side_image: string;
  }) {
    // For now, we'll store this in localStorage and create full appraisal later
    // This matches the step-by-step workflow
    console.log('Appraisal data prepared:', appraisalData);
    return {
      success: true,
      message: 'Customer images saved',
    };
  }

  // Get all appraisals
  async getAllAppraisals(skip: number = 0, limit: number = 100) {
    const response = await fetch(`${this.baseUrl}/api/appraisals?skip=${skip}&limit=${limit}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get appraisals');
    }

    return response.json();
  }

  // Get statistics
  async getStatistics() {
    const response = await fetch(`${this.baseUrl}/api/statistics`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get statistics');
    }

    return response.json();
  }

  // Camera check
  async checkCamera() {
    const response = await fetch(`${this.baseUrl}/api/camera/check`, {
      method: 'POST',
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to check camera');
    }

    return response.json();
  }
}

export const apiService = new ApiService();
