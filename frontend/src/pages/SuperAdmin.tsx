import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Building2,
  GitBranch,
  Lock,
  Mail,
  Shield,
  Loader2,
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Search,
  LogOut,
  RefreshCw,
  X,
  Save,
  Calendar,
  Phone,
  MapPin,
  User,
  CheckCircle,
  Eye,
  EyeOff,
  Users,
  Camera,
  UserPlus
} from 'lucide-react';
import NotFound from './NotFound';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// LocalStorage keys for super admin (persists across refresh/tabs)
const SUPER_ADMIN_TOKEN_KEY = 'super_admin_jwt_token';
const SUPER_ADMIN_SESSION_KEY = 'super_admin_session';

interface Bank {
  id: number;
  bank_name: string;
  bank_code: string;
  bank_short_name: string;
  headquarters_address?: string;
  contact_email?: string;
  contact_phone?: string;
  rbi_license_number?: string;
  is_active: boolean;
  created_at: string;
}

interface Branch {
  id: number;
  branch_name: string;
  branch_code: string;
  branch_address?: string;
  branch_city?: string;
  branch_state?: string;
  branch_pincode?: string;
  contact_phone?: string;
  contact_email?: string;
  manager_name?: string;
  is_active: boolean;
  bank_id: number;
  bank_name?: string;
  created_at: string;
}

interface BankFormData {
  bank_name: string;
  bank_code: string;
  bank_short_name: string;
  headquarters_address: string;
  contact_email: string;
  contact_phone: string;
  rbi_license_number: string;
}

interface BranchFormData {
  branch_name: string;
  branch_code: string;
  branch_address: string;
  branch_city: string;
  branch_state: string;
  branch_pincode: string;
  contact_phone: string;
  contact_email: string;
  manager_name: string;
  bank_id: number | '';
}

interface BankAdmin {
  id: number;
  bank_id: number;
  email: string;
  phone?: string;
  full_name?: string;
  is_active: boolean;
  bank_name?: string;
  created_at?: string;
}

interface BankAdminFormData {
  bank_id: number | '';
  email: string;
  password: string;
  phone: string;
  full_name: string;
}

interface BranchAdmin {
  id: number;
  user_id: string;
  branch_id: number;
  bank_id: number;
  email: string;
  phone?: string;
  full_name: string;
  is_active: boolean;
  created_at?: string;
  branch_name?: string;
  bank_name?: string;
}

interface BranchAdminFormData {
  bank_id: number | '';
  branch_id: number | '';
  email: string;
  password: string;
  phone: string;
  full_name: string;
}

const initialBankForm: BankFormData = {
  bank_name: '',
  bank_code: '',
  bank_short_name: '',
  headquarters_address: '',
  contact_email: '',
  contact_phone: '',
  rbi_license_number: ''
};

const initialBranchForm: BranchFormData = {
  branch_name: '',
  branch_code: '',
  branch_address: '',
  branch_city: '',
  branch_state: '',
  branch_pincode: '',
  contact_phone: '',
  contact_email: '',
  manager_name: '',
  bank_id: ''
};

const initialBankAdminForm: BankAdminFormData = {
  bank_id: '',
  email: '',
  password: '',
  phone: '',
  full_name: ''
};

const initialBranchAdminForm: BranchAdminFormData = {
  bank_id: '',
  branch_id: '',
  email: '',
  password: '',
  phone: '',
  full_name: ''
};

const SuperAdmin: React.FC = () => {
  const navigate = useNavigate();
  
  // Authentication state
  const [isVerifying, setIsVerifying] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showNotFound, setShowNotFound] = useState(false);
  
  // Login form state
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Data state
  const [banks, setBanks] = useState<Bank[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBankId, setSelectedBankId] = useState<number | null>(null);
  
  // Bank modal state
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [bankForm, setBankForm] = useState<BankFormData>(initialBankForm);
  const [savingBank, setSavingBank] = useState(false);
  const [deletingBankId, setDeletingBankId] = useState<number | null>(null);
  
  // Branch modal state
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchForm, setBranchForm] = useState<BranchFormData>(initialBranchForm);
  const [savingBranch, setSavingBranch] = useState(false);
  const [deletingBranchId, setDeletingBranchId] = useState<number | null>(null);
  
  // Bank Admin state
  const [bankAdmins, setBankAdmins] = useState<BankAdmin[]>([]);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminForm, setAdminForm] = useState<BankAdminFormData>(initialBankAdminForm);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Branch Admin state
  const [branchAdmins, setBranchAdmins] = useState<BranchAdmin[]>([]);
  const [showBranchAdminModal, setShowBranchAdminModal] = useState(false);
  const [branchAdminForm, setBranchAdminForm] = useState<BranchAdminFormData>(initialBranchAdminForm);
  const [savingBranchAdmin, setSavingBranchAdmin] = useState(false);
  const [deletingBranchAdminId, setDeletingBranchAdminId] = useState<number | null>(null);
  const [showBranchAdminPassword, setShowBranchAdminPassword] = useState(false);
  const [filteredBranchesForAdmin, setFilteredBranchesForAdmin] = useState<Branch[]>([]);

  // Registered Appraisers state (RBAC - Super Admin sees all)
  const [registeredAppraisers, setRegisteredAppraisers] = useState<any[]>([]);
  const [loadingAppraisers, setLoadingAppraisers] = useState(false);
  const [appraisersSearchTerm, setAppraisersSearchTerm] = useState('');
  
  // Appraiser Registration state
  const [showAppraiserModal, setShowAppraiserModal] = useState(false);
  const [appraiserForm, setAppraiserForm] = useState({ full_name: '', email: '', phone: '' });
  const [regSelectedBankId, setRegSelectedBankId] = useState<number | null>(null);
  const [regSelectedBranchId, setRegSelectedBranchId] = useState<number | null>(null);
  const [regFilteredBranches, setRegFilteredBranches] = useState<Branch[]>([]);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [savingAppraiser, setSavingAppraiser] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  // Get stored token from localStorage (persists across refresh)
  const getToken = () => localStorage.getItem(SUPER_ADMIN_TOKEN_KEY);

  // Verify existing session on mount
  useEffect(() => {
    verifySession();
  }, []);

  const verifySession = async () => {
    const token = getToken();
    if (!token) {
      setIsVerifying(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/super-admin/verify`, {
        headers: {
          'X-Super-Admin-Token': token
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.valid) {
          setIsAuthenticated(true);
          fetchData();
        } else {
          // Invalid token - clear storage
          localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
          localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
        }
      }
    } catch (err) {
      console.error('Session verification failed:', err);
      // Clear storage on error
      localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
      localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
    }
    
    setIsVerifying(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/super-admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ credential, password })
      });

      const data = await response.json();

      if (data.success && data.token) {
        // Store JWT token in localStorage (persists across refresh/tabs)
        localStorage.setItem(SUPER_ADMIN_TOKEN_KEY, data.token);
        localStorage.setItem(SUPER_ADMIN_SESSION_KEY, JSON.stringify(data.user));
        // Clear login attempts on success
        localStorage.removeItem('super_login_attempts');
        setIsAuthenticated(true);
        fetchData();
      } else {
        // After 3 failed attempts, show 404 to conceal page existence
        const attempts = parseInt(localStorage.getItem('super_login_attempts') || '0') + 1;
        localStorage.setItem('super_login_attempts', attempts.toString());
        
        if (attempts >= 3) {
          setShowNotFound(true);
          return;
        }
        
        setLoginError('Invalid credentials');
      }
    } catch (err) {
      setLoginError('Authentication failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    const token = getToken();
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/super-admin/logout`, {
          method: 'POST',
          headers: {
            'X-Super-Admin-Token': token
          }
        });
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    
    // Clear localStorage for persistent logout
    localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
    localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
    localStorage.removeItem('super_login_attempts');
    setIsAuthenticated(false);
    setCredential('');
    setPassword('');
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    const token = getToken();
    
    try {
      const [banksRes, branchesRes, branchAdminsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/bank`),
        fetch(`${API_BASE_URL}/api/branch`),
        token ? fetch(`${API_BASE_URL}/api/admin/all-branch-admins`, {
          headers: { 'X-Super-Admin-Token': token }
        }) : Promise.resolve({ ok: false })
      ]);

      if (banksRes.ok) {
        const banksData = await banksRes.json();
        setBanks(Array.isArray(banksData) ? banksData : []);
        
        // Fetch bank admins for all banks
        if (token && Array.isArray(banksData) && banksData.length > 0) {
          const adminPromises = banksData.map(bank =>
            fetch(`${API_BASE_URL}/api/admin/bank-admins/${bank.id}`, {
              headers: { 'X-Super-Admin-Token': token }
            }).then(res => res.ok ? res.json() : [])
          );
          
          const adminResults = await Promise.all(adminPromises);
          const allAdmins = adminResults.flat();
          setBankAdmins(Array.isArray(allAdmins) ? allAdmins : []);
        }
      }

      if (branchesRes.ok) {
        const branchesData = await branchesRes.json();
        setBranches(Array.isArray(branchesData) ? branchesData : []);
      }

      if (branchAdminsRes.ok) {
        const branchAdminsData = await branchAdminsRes.json();
        setBranchAdmins(Array.isArray(branchAdminsData) ? branchAdminsData : []);
      }
      
      // Fetch registered appraisers (Super Admin sees all)
      await fetchAppraisers();
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch appraisers with RBAC (Super Admin sees all)
  const fetchAppraisers = async () => {
    setLoadingAppraisers(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/appraisers/all?role=super_admin`);
      if (response.ok) {
        const data = await response.json();
        setRegisteredAppraisers(data.appraisers || []);
      }
    } catch (error) {
      console.error('Error fetching appraisers:', error);
    } finally {
      setLoadingAppraisers(false);
    }
  };

  // Filter appraisers based on search
  const filteredAppraisers = registeredAppraisers.filter(appraiser =>
    appraiser.name?.toLowerCase().includes(appraisersSearchTerm.toLowerCase()) ||
    appraiser.appraiser_id?.toLowerCase().includes(appraisersSearchTerm.toLowerCase()) ||
    appraiser.email?.toLowerCase().includes(appraisersSearchTerm.toLowerCase()) ||
    appraiser.bank_name?.toLowerCase().includes(appraisersSearchTerm.toLowerCase()) ||
    appraiser.branch_name?.toLowerCase().includes(appraisersSearchTerm.toLowerCase())
  );

  // Filter branches for registration form based on selected bank
  React.useEffect(() => {
    if (regSelectedBankId) {
      const filtered = branches.filter(branch => branch.bank_id === regSelectedBankId);
      setRegFilteredBranches(filtered);
      if (regSelectedBranchId && !filtered.find(b => b.id === regSelectedBranchId)) {
        setRegSelectedBranchId(null);
      }
    } else {
      setRegFilteredBranches([]);
      setRegSelectedBranchId(null);
    }
  }, [regSelectedBankId, branches]);

  // Camera functions for appraiser registration
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedPhoto(imageData);
        stopCamera();
      }
    }
  };

  const retakePhoto = () => {
    setCapturedPhoto(null);
    startCamera();
  };

  const generateAppraiserId = () => {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 6);
    return `APP-${timestamp}-${randomStr}`.toUpperCase();
  };

  const handleAppraiserFormChange = (field: string, value: string) => {
    setAppraiserForm(prev => ({ ...prev, [field]: value }));
  };

  const registerAppraiser = async () => {
    if (!appraiserForm.full_name.trim() || !appraiserForm.email.trim() || !appraiserForm.phone.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    if (!regSelectedBankId || !regSelectedBranchId) {
      alert('Please select bank and branch');
      return;
    }
    if (!capturedPhoto) {
      alert('Please capture a face photo');
      return;
    }

    setSavingAppraiser(true);
    setRegistrationSuccess(false);
    setRegistrationMessage('');

    try {
      const appraiserId = generateAppraiserId();
      const timestamp = new Date().toISOString();
      const bankName = banks.find(b => b.id === regSelectedBankId)?.bank_name || '';
      const branchName = regFilteredBranches.find(b => b.id === regSelectedBranchId)?.branch_name || '';

      const payload = {
        name: appraiserForm.full_name.trim(),
        id: appraiserId,
        image: capturedPhoto,
        timestamp: timestamp,
        bank_id: regSelectedBankId,
        branch_id: regSelectedBranchId,
        bank: bankName,
        branch: branchName,
        email: appraiserForm.email.trim(),
        phone: appraiserForm.phone.trim(),
        registrar_role: 'super_admin',
        registrar_bank_id: null,
        registrar_branch_id: null
      };

      const response = await fetch(`${API_BASE_URL}/api/appraiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to register appraiser');
      }

      setRegistrationSuccess(true);
      setRegistrationMessage(`Appraiser registered successfully! ID: ${appraiserId}`);
      fetchAppraisers();

      setTimeout(() => {
        setAppraiserForm({ full_name: '', email: '', phone: '' });
        setCapturedPhoto(null);
        setRegSelectedBankId(null);
        setRegSelectedBranchId(null);
        setRegistrationSuccess(false);
        setRegistrationMessage('');
      }, 3000);

    } catch (error) {
      console.error('Error registering appraiser:', error);
      setRegistrationMessage(error instanceof Error ? error.message : 'Failed to register appraiser');
    } finally {
      setSavingAppraiser(false);
    }
  };

  // Cleanup camera on unmount
  React.useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // =========================================================================
  // Bank CRUD Operations
  // =========================================================================

  const openAddBankModal = () => {
    setBankForm(initialBankForm);
    setEditingBank(null);
    setShowBankModal(true);
  };

  const openEditBankModal = (bank: Bank) => {
    setBankForm({
      bank_name: bank.bank_name,
      bank_code: bank.bank_code,
      bank_short_name: bank.bank_short_name,
      headquarters_address: bank.headquarters_address || '',
      contact_email: bank.contact_email || '',
      contact_phone: bank.contact_phone || '',
      rbi_license_number: bank.rbi_license_number || ''
    });
    setEditingBank(bank);
    setShowBankModal(true);
  };

  const closeBankModal = () => {
    setShowBankModal(false);
    setEditingBank(null);
    setBankForm(initialBankForm);
  };

  const handleBankFormChange = (field: keyof BankFormData, value: string) => {
    setBankForm(prev => ({ ...prev, [field]: value }));
  };

  const saveBank = async () => {
    if (!bankForm.bank_name || !bankForm.bank_code) {
      alert('Bank name and code are required');
      return;
    }

    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    setSavingBank(true);
    try {
      const url = editingBank
        ? `${API_BASE_URL}/api/bank/${editingBank.id}`
        : `${API_BASE_URL}/api/bank`;

      const method = editingBank ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Super-Admin-Token': token
        },
        body: JSON.stringify(bankForm)
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save bank');
      }

      await fetchData();
      closeBankModal();
    } catch (error) {
      console.error('Error saving bank:', error);
      alert(error instanceof Error ? error.message : 'Failed to save bank');
    } finally {
      setSavingBank(false);
    }
  };

  const deleteBank = async (bankId: number, force: boolean = false) => {
    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    try {
      const url = force 
        ? `${API_BASE_URL}/api/bank/${bankId}?force=true`
        : `${API_BASE_URL}/api/bank/${bankId}`;
        
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'X-Super-Admin-Token': token
        }
      });

      if (response.status === 403) {
        alert('Access denied. Your session may have expired. Please login again.');
        setIsAuthenticated(false);
        localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
        localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
        setDeletingBankId(null);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // If it's a 400 error about branches, offer force delete option
        if (response.status === 400 && errorData.detail && errorData.detail.includes('branches')) {
          const branchCount = errorData.detail.match(/(\d+) branches/)?.[1] || 'some';
          const confirmForce = confirm(
            `${errorData.detail}\n\n` +
            `⚠️ WARNING: Force delete will permanently remove:\n` +
            `• The bank and all ${branchCount} branches\n` +
            `• All associated data (users, sessions, appraisals)\n` +
            `• This action CANNOT be undone!\n\n` +
            `Do you want to proceed with force delete?`
          );
          
          if (confirmForce) {
            return deleteBank(bankId, true); // Recursive call with force=true
          } else {
            setDeletingBankId(null);
            return;
          }
        }
        
        throw new Error(errorData.detail || 'Failed to delete bank');
      }

      const result = await response.json();
      alert(result.message || 'Bank deleted successfully');
      await fetchData();
      setDeletingBankId(null);
    } catch (error) {
      console.error('Error deleting bank:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete bank');
      setDeletingBankId(null);
    }
  };

  // =========================================================================
  // Branch CRUD Operations
  // =========================================================================

  const openAddBranchModal = () => {
    setBranchForm(initialBranchForm);
    setEditingBranch(null);
    setShowBranchModal(true);
  };

  const openEditBranchModal = (branch: Branch) => {
    setBranchForm({
      branch_name: branch.branch_name,
      branch_code: branch.branch_code,
      branch_address: branch.branch_address || '',
      branch_city: branch.branch_city || '',
      branch_state: branch.branch_state || '',
      branch_pincode: branch.branch_pincode || '',
      contact_phone: branch.contact_phone || '',
      contact_email: branch.contact_email || '',
      manager_name: branch.manager_name || '',
      bank_id: branch.bank_id
    });
    setEditingBranch(branch);
    setShowBranchModal(true);
  };

  const closeBranchModal = () => {
    setShowBranchModal(false);
    setEditingBranch(null);
    setBranchForm(initialBranchForm);
  };

  const handleBranchFormChange = (field: keyof BranchFormData, value: string | number) => {
    setBranchForm(prev => ({ ...prev, [field]: value }));
  };

  const saveBranch = async () => {
    if (!branchForm.branch_name || !branchForm.branch_code || !branchForm.bank_id) {
      alert('Branch name, code, and bank are required');
      return;
    }

    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    setSavingBranch(true);
    try {
      const url = editingBranch
        ? `${API_BASE_URL}/api/branch/${editingBranch.id}`
        : `${API_BASE_URL}/api/branch`;

      const method = editingBranch ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Super-Admin-Token': token
        },
        body: JSON.stringify(branchForm)
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save branch');
      }

      await fetchData();
      closeBranchModal();
    } catch (error) {
      console.error('Error saving branch:', error);
      alert(error instanceof Error ? error.message : 'Failed to save branch');
    } finally {
      setSavingBranch(false);
    }
  };

  const deleteBranch = async (branchId: number) => {
    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/branch/${branchId}`, {
        method: 'DELETE',
        headers: {
          'X-Super-Admin-Token': token
        }
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete branch');
      }

      await fetchData();
      setDeletingBranchId(null);
    } catch (error) {
      console.error('Error deleting branch:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete branch');
    }
  };

  // =========================================================================
  // Bank Admin Management
  // =========================================================================

  const openAddAdminModal = () => {
    setAdminForm(initialBankAdminForm);
    setShowAdminModal(true);
  };

  const closeAdminModal = () => {
    setShowAdminModal(false);
    setAdminForm(initialBankAdminForm);
    setShowPassword(false);
  };

  const handleAdminFormChange = (field: keyof BankAdminFormData, value: any) => {
    setAdminForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveAdmin = async () => {
    const token = getToken();
    if (!token) {
      alert('Authentication required');
      return;
    }

    if (!adminForm.bank_id || !adminForm.email || !adminForm.password) {
      alert('Please fill in all required fields (Bank, Email, and Password)');
      return;
    }

    setSavingAdmin(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/bank-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Super-Admin-Token': token
        },
        body: JSON.stringify(adminForm)
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create bank admin');
      }

      await fetchData();
      closeAdminModal();
      alert('Bank Admin created successfully with login credentials!');
    } catch (error) {
      console.error('Error saving admin:', error);
      setError(error instanceof Error ? error.message : 'Failed to save admin');
      alert(error instanceof Error ? error.message : 'Failed to save admin');
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (adminId: number) => {
    if (!confirm('Are you sure you want to delete this bank admin? This will revoke their login access.')) {
      return;
    }

    const token = getToken();
    if (!token) {
      alert('Authentication required');
      return;
    }

    setDeletingAdminId(adminId);

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/bank-admin/${adminId}`, {
        method: 'DELETE',
        headers: {
          'X-Super-Admin-Token': token
        }
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete bank admin');
      }

      await fetchData();
      setDeletingAdminId(null);
      alert('Bank Admin deleted successfully');
    } catch (error) {
      console.error('Error deleting admin:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete admin');
    }
  };

  // =========================================================================
  // Branch Admin CRUD Operations
  // =========================================================================

  const openAddBranchAdminModal = () => {
    setBranchAdminForm(initialBranchAdminForm);
    setShowBranchAdminModal(true);
    setShowBranchAdminPassword(false);
    setFilteredBranchesForAdmin([]);
  };

  const closeBranchAdminModal = () => {
    setShowBranchAdminModal(false);
    setBranchAdminForm(initialBranchAdminForm);
    setShowBranchAdminPassword(false);
    setFilteredBranchesForAdmin([]);
  };

  const handleBranchAdminFormChange = (field: keyof BranchAdminFormData, value: string) => {
    setBranchAdminForm(prev => {
      const updated = { ...prev, [field]: value };
      
      // Filter branches when bank changes
      if (field === 'bank_id') {
        const bankId = parseInt(value);
        if (bankId) {
          const filteredBranches = branches.filter(b => b.bank_id === bankId);
          setFilteredBranchesForAdmin(filteredBranches);
        } else {
          setFilteredBranchesForAdmin([]);
        }
        updated.branch_id = '';
      }
      
      return updated;
    });
  };

  const handleSaveBranchAdmin = async () => {
    if (!branchAdminForm.bank_id || !branchAdminForm.branch_id || !branchAdminForm.email || !branchAdminForm.password || !branchAdminForm.full_name) {
      setError('Please fill in all required fields');
      return;
    }

    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    setSavingBranchAdmin(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/branch-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Super-Admin-Token': token
        },
        body: JSON.stringify({
          branch_id: parseInt(branchAdminForm.branch_id.toString()),
          email: branchAdminForm.email,
          password: branchAdminForm.password,
          full_name: branchAdminForm.full_name,
          phone: branchAdminForm.phone || null
        })
      });

      if (response.status === 403) {
        setError('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create branch admin');
      }

      await fetchData();
      closeBranchAdminModal();
      setError(null);
    } catch (err) {
      console.error('Error creating branch admin:', err);
      setError(err instanceof Error ? err.message : 'Failed to create branch admin');
    } finally {
      setSavingBranchAdmin(false);
    }
  };

  const handleDeleteBranchAdmin = async (adminId: number) => {
    if (!confirm('Are you sure you want to delete this branch admin? This will revoke their login access.')) {
      return;
    }

    const token = getToken();
    if (!token) {
      alert('Authentication required');
      return;
    }

    setDeletingBranchAdminId(adminId);

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/branch-admin/${adminId}`, {
        method: 'DELETE',
        headers: {
          'X-Super-Admin-Token': token
        }
      });

      if (response.status === 403) {
        alert('Access denied. Super Admin privileges required.');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete branch admin');
      }

      await fetchData();
      setDeletingBranchAdminId(null);
      alert('Branch Admin deleted successfully');
    } catch (error) {
      console.error('Error deleting branch admin:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete branch admin');
    } finally {
      setDeletingBranchAdminId(null);
    }
  };

  // =========================================================================
  // Helpers
  // =========================================================================

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getBankName = (bankId: number): string => {
    const bank = banks.find(b => b.id === bankId);
    return bank?.bank_name || 'Unknown Bank';
  };

  const filteredBanks = banks.filter(bank =>
    bank.bank_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bank.bank_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBranches = branches.filter(branch => {
    const matchesSearch = 
      branch.branch_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      branch.branch_code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBank = !selectedBankId || branch.bank_id === selectedBankId;
    return matchesSearch && matchesBank;
  });

  // =========================================================================
  // Render - Show 404 if concealment is needed
  // =========================================================================

  if (showNotFound) {
    return <NotFound />;
  }

  // Show loading while verifying session
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-10 h-10 text-slate-400 animate-spin" />
      </div>
    );
  }

  // =========================================================================
  // Render - Login Form (when not authenticated)
  // =========================================================================

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-100 p-4">
        <Card className="w-full max-w-md bg-white/90 backdrop-blur-lg border-blue-200 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">System Access</CardTitle>
            <p className="text-blue-600 text-sm mt-2">Restricted Area</p>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="credential" className="text-gray-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-600" />
                  Email or Phone
                </Label>
                <Input
                  id="credential"
                  type="text"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder="Enter email or phone"
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-600" />
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              {loginError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm">{loginError}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50"
              >
                {isLoggingIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Lock className="w-5 h-5" />
                    Access System
                  </span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================================================
  // Render - Super Admin Dashboard (when authenticated)
  // =========================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100">
      {/* Header */}
      <div className="bg-white border-b border-blue-200 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Super Admin Console</h1>
              <p className="text-blue-600 text-sm">Bank & Branch Management</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
              <Shield className="w-3 h-3 mr-1" />
              Super Admin
            </Badge>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleLogout}
              className="text-gray-700 border-blue-300 hover:bg-blue-50 hover:text-blue-800 gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
            <span className="ml-2 text-slate-400">Loading...</span>
          </div>
        ) : (
          <Tabs defaultValue="banks" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <TabsList className="bg-white border border-blue-200 flex-wrap">
                <TabsTrigger value="banks" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <Building2 className="w-4 h-4" />
                  Banks ({banks.length})
                </TabsTrigger>
                <TabsTrigger value="branches" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <GitBranch className="w-4 h-4" />
                  Branches ({branches.length})
                </TabsTrigger>
                <TabsTrigger value="admins" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <Users className="w-4 h-4" />
                  Bank Admins ({bankAdmins.length})
                </TabsTrigger>
                <TabsTrigger value="branch-admins" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <User className="w-4 h-4" />
                  Branch Admins ({branchAdmins.length})
                </TabsTrigger>
                <TabsTrigger value="appraisers" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <Users className="w-4 h-4" />
                  Appraisers ({registeredAppraisers.length})
                </TabsTrigger>
                <TabsTrigger value="add-appraiser" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
                  <UserPlus className="w-4 h-4" />
                  Add Appraiser
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-white border-blue-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500"
                  />
                </div>
                <Button onClick={fetchData} variant="outline" size="icon" className="border-blue-300 text-blue-600 hover:bg-blue-50">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Banks Tab */}
            <TabsContent value="banks" className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900">Manage Banks</h2>
                <Button onClick={openAddBankModal} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  <Plus className="w-4 h-4" />
                  Add Bank
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBanks.map((bank) => (
                  <Card key={bank.id} className="bg-white border-blue-200 hover:border-blue-300 shadow-sm transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-gray-900 flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-blue-600" />
                            {bank.bank_name}
                          </CardTitle>
                          <Badge variant="outline" className="mt-1 border-blue-300 text-blue-700">
                            {bank.bank_code}
                          </Badge>
                        </div>
                        <Badge className={bank.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                          {bank.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {bank.headquarters_address && (
                        <div className="flex items-start gap-2 text-sm text-gray-600">
                          <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>{bank.headquarters_address}</span>
                        </div>
                      )}
                      {bank.contact_email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail className="w-4 h-4" />
                          <span>{bank.contact_email}</span>
                        </div>
                      )}
                      {bank.contact_phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span>{bank.contact_phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        <span>Created: {formatDate(bank.created_at)}</span>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-blue-200">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditBankModal(bank)}
                          className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50 gap-1"
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                        {deletingBankId === bank.id ? (
                          <div className="flex gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteBank(bank.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeletingBankId(null)}
                              className="border-blue-300 text-blue-700"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeletingBankId(bank.id)}
                            className="border-red-600 text-red-400 hover:bg-red-600/20"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Branches Tab */}
            <TabsContent value="branches" className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold text-gray-900">Manage Branches</h2>
                  <select
                    value={selectedBankId || ''}
                    onChange={(e) => setSelectedBankId(e.target.value ? Number(e.target.value) : null)}
                    className="px-3 py-1 bg-white border border-blue-200 rounded text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">All Banks</option>
                    {banks.map(bank => (
                      <option key={bank.id} value={bank.id}>{bank.bank_name}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={openAddBranchModal} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  <Plus className="w-4 h-4" />
                  Add Branch
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBranches.map((branch) => (
                  <Card key={branch.id} className="bg-white border-blue-200 hover:border-blue-300 shadow-sm transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-gray-900 flex items-center gap-2">
                            <GitBranch className="w-4 h-4 text-blue-600" />
                            {branch.branch_name}
                          </CardTitle>
                          <Badge variant="outline" className="mt-1 border-blue-300 text-blue-700">
                            {branch.branch_code}
                          </Badge>
                        </div>
                        <Badge className={branch.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                          {branch.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-blue-600">
                        <Building2 className="w-4 h-4" />
                        <span>{getBankName(branch.bank_id)}</span>
                      </div>
                      {branch.branch_address && (
                        <div className="flex items-start gap-2 text-sm text-gray-600">
                          <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>
                            {branch.branch_address}
                            {branch.branch_city && `, ${branch.branch_city}`}
                            {branch.branch_state && `, ${branch.branch_state}`}
                          </span>
                        </div>
                      )}
                      {branch.contact_email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail className="w-4 h-4" />
                          <span className="truncate">{branch.contact_email}</span>
                        </div>
                      )}
                      {branch.contact_phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span>{branch.contact_phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        <span>Created: {formatDate(branch.created_at)}</span>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-blue-200">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditBranchModal(branch)}
                          className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50 gap-1"
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                        {deletingBranchId === branch.id ? (
                          <div className="flex gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteBranch(branch.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeletingBranchId(null)}
                              className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeletingBranchId(branch.id)}
                            className="border-red-300 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Bank Admins Tab */}
            <TabsContent value="admins" className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900">Manage Bank Admins</h2>
                <Button onClick={openAddAdminModal} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  <Plus className="w-4 h-4" />
                  Add Bank Admin
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {bankAdmins.map((admin) => (
                  <Card key={admin.id} className="bg-white border-blue-200 hover:border-blue-300 shadow-sm transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <CardTitle className="text-gray-900 flex items-center gap-2">
                            <User className="w-4 h-4 text-blue-600" />
                            {admin.full_name || 'Bank Admin'}
                          </CardTitle>
                          <Badge variant="outline" className="mt-1 border-blue-300 text-blue-700">
                            {admin.bank_name || `Bank ID: ${admin.bank_id}`}
                          </Badge>
                        </div>
                        <Badge className={admin.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                          {admin.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{admin.email}</span>
                      </div>
                      {admin.phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span>{admin.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Lock className="w-4 h-4" />
                        <span className="text-xs text-gray-500">Password Protected Login</span>
                      </div>
                      {admin.created_at && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Calendar className="w-3 h-3" />
                          <span>Created: {formatDate(admin.created_at)}</span>
                        </div>
                      )}

                      <div className="flex gap-2 pt-2 border-t border-blue-200">
                        {deletingAdminId === admin.id ? (
                          <div className="flex gap-1 w-full">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteAdmin(admin.id)}
                              className="flex-1"
                            >
                              Confirm Delete
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeletingAdminId(null)}
                              className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeletingAdminId(admin.id)}
                            className="w-full border-red-300 text-red-600 hover:bg-red-50 gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete Admin
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {bankAdmins.length === 0 && (
                <Card className="bg-white border-blue-200">
                  <CardContent className="text-center py-12">
                    <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No bank admins created yet.</p>
                    <p className="text-gray-500 text-sm mt-2">Create bank admins to manage their respective banks.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Branch Admins Tab */}
            <TabsContent value="branch-admins" className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Branch Administrators</h2>
                <Button onClick={openAddBranchAdminModal} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                  <Plus className="w-4 h-4" />
                  Add Branch Admin
                </Button>
              </div>

              {branchAdmins.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {branchAdmins.map((admin) => (
                    <Card key={admin.id} className="bg-white border border-blue-200 hover:shadow-lg transition-shadow">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900">{admin.full_name}</h3>
                            <Badge variant={admin.is_active ? "default" : "secondary"}>
                              {admin.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          
                          <div className="space-y-2 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <Mail className="w-3 h-3" />
                              <span>{admin.email}</span>
                            </div>
                            {admin.phone && (
                              <div className="flex items-center gap-2">
                                <Phone className="w-3 h-3" />
                                <span>{admin.phone}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Building2 className="w-3 h-3" />
                              <span>{admin.bank_name || 'Unknown Bank'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <GitBranch className="w-3 h-3" />
                              <span>{admin.branch_name || 'Unknown Branch'}</span>
                            </div>
                            {admin.created_at && (
                              <div className="flex items-center gap-2">
                                <Calendar className="w-3 h-3" />
                                <span>Created: {formatDate(admin.created_at)}</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex justify-end pt-2">
                            <Button
                              onClick={() => handleDeleteBranchAdmin(admin.id)}
                              variant="destructive"
                              size="sm"
                              disabled={deletingBranchAdminId === admin.id}
                              className="gap-1"
                            >
                              {deletingBranchAdminId === admin.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="bg-white border border-blue-200">
                  <CardContent className="py-12 text-center">
                    <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No branch admins created yet.</p>
                    <p className="text-gray-500 text-sm mt-2">Create branch admins to manage specific branches.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Registered Appraisers Tab */}
            <TabsContent value="appraisers" className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Registered Appraisers</h2>
                  <p className="text-sm text-gray-500">View all appraisers across all banks and branches</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Search appraisers..."
                      value={appraisersSearchTerm}
                      onChange={(e) => setAppraisersSearchTerm(e.target.value)}
                      className="pl-10 bg-white border-blue-200"
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={fetchAppraisers}
                    disabled={loadingAppraisers}
                    className="border-blue-300 text-blue-600 hover:bg-blue-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingAppraisers ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {loadingAppraisers ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <span className="ml-2 text-gray-600">Loading appraisers...</span>
                </div>
              ) : filteredAppraisers.length === 0 ? (
                <Card className="bg-white border border-blue-200">
                  <CardContent className="py-12 text-center">
                    <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No appraisers found.</p>
                    <p className="text-gray-500 text-sm mt-2">
                      {appraisersSearchTerm ? 'Try adjusting your search' : 'Register appraisers to see them here.'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-white border border-blue-200">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="text-left p-3 font-semibold text-gray-700">Appraiser</th>
                            <th className="text-left p-3 font-semibold text-gray-700">ID</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Bank</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Branch</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Contact</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Status</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Appraisals</th>
                            <th className="text-left p-3 font-semibold text-gray-700">Registered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAppraisers.map((appraiser) => (
                            <tr key={appraiser.id} className="border-b hover:bg-gray-50">
                              <td className="p-3">
                                <div className="flex items-center gap-3">
                                  {appraiser.image_data ? (
                                    <img 
                                      src={appraiser.image_data} 
                                      alt={appraiser.name}
                                      className="w-10 h-10 rounded-full object-cover border"
                                    />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                                      <User className="h-5 w-5 text-gray-500" />
                                    </div>
                                  )}
                                  <span className="font-medium">{appraiser.name}</span>
                                </div>
                              </td>
                              <td className="p-3">
                                <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                                  {appraiser.appraiser_id}
                                </code>
                              </td>
                              <td className="p-3 text-sm">{appraiser.bank_name || '-'}</td>
                              <td className="p-3 text-sm">{appraiser.branch_name || '-'}</td>
                              <td className="p-3">
                                <div className="text-sm">
                                  {appraiser.email && (
                                    <div className="flex items-center gap-1 text-gray-600">
                                      <Mail className="h-3 w-3" />
                                      {appraiser.email}
                                    </div>
                                  )}
                                  {appraiser.phone && (
                                    <div className="flex items-center gap-1 text-gray-600">
                                      <Phone className="h-3 w-3" />
                                      {appraiser.phone}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="p-3">
                                <Badge className={appraiser.has_face_encoding 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-yellow-100 text-yellow-800'
                                }>
                                  {appraiser.has_face_encoding ? 'Face Registered' : 'No Face'}
                                </Badge>
                              </td>
                              <td className="p-3 text-center">
                                <Badge variant="outline">
                                  {appraiser.appraisals_completed || 0}
                                </Badge>
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {appraiser.created_at ? new Date(appraiser.created_at).toLocaleDateString() : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-4 border-t text-sm text-gray-500 text-center">
                      Showing {filteredAppraisers.length} of {registeredAppraisers.length} appraisers
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Add Appraiser Tab */}
            <TabsContent value="add-appraiser" className="space-y-4">
              <Card className="bg-white border border-blue-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-900">
                    <UserPlus className="h-5 w-5 text-blue-600" />
                    Register New Appraiser
                    <Badge variant="outline" className="ml-2">Super Admin - Select Bank & Branch</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Form Section */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-gray-700">Full Name *</Label>
                        <Input
                          value={appraiserForm.full_name}
                          onChange={(e) => handleAppraiserFormChange('full_name', e.target.value)}
                          placeholder="Enter appraiser's full name"
                          className="bg-white border-blue-200"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">Bank *</Label>
                        <select
                          value={regSelectedBankId || ''}
                          onChange={(e) => setRegSelectedBankId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full p-2 border border-blue-200 rounded-md bg-white"
                        >
                          <option value="">Select Bank</option>
                          {banks.map(bank => (
                            <option key={bank.id} value={bank.id}>{bank.bank_name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">Branch *</Label>
                        <select
                          value={regSelectedBranchId || ''}
                          onChange={(e) => setRegSelectedBranchId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full p-2 border border-blue-200 rounded-md bg-white"
                          disabled={!regSelectedBankId}
                        >
                          <option value="">Select Branch</option>
                          {regFilteredBranches.map(branch => (
                            <option key={branch.id} value={branch.id}>{branch.branch_name}</option>
                          ))}
                        </select>
                        {!regSelectedBankId && (
                          <p className="text-sm text-gray-500">Please select a bank first</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">Email *</Label>
                        <Input
                          type="email"
                          value={appraiserForm.email}
                          onChange={(e) => handleAppraiserFormChange('email', e.target.value)}
                          placeholder="appraiser@example.com"
                          className="bg-white border-blue-200"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">Phone Number *</Label>
                        <Input
                          type="tel"
                          value={appraiserForm.phone}
                          onChange={(e) => handleAppraiserFormChange('phone', e.target.value)}
                          placeholder="Enter phone number"
                          className="bg-white border-blue-200"
                        />
                      </div>
                    </div>

                    {/* Camera Section */}
                    <div className="space-y-4">
                      <Label className="text-gray-700">Face Photo *</Label>
                      <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 min-h-[300px] bg-gray-50">
                        {!capturedPhoto ? (
                          <div className="space-y-4">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className={`w-full h-64 rounded-lg bg-black object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                              style={{ transform: 'scaleX(-1)' }}
                            />
                            
                            {isCameraActive && (
                              <Button 
                                onClick={capturePhoto} 
                                className="w-full gap-2 bg-green-600 hover:bg-green-700"
                              >
                                <Camera className="h-4 w-4" />
                                Capture Photo
                              </Button>
                            )}
                            
                            {!isCameraActive && (
                              <div className="flex flex-col items-center justify-center py-8">
                                <Camera className="h-16 w-16 text-gray-400 mb-4" />
                                <p className="text-gray-600 mb-4">Click to start camera</p>
                                <Button onClick={startCamera} className="gap-2 bg-blue-600 hover:bg-blue-700">
                                  <Camera className="h-4 w-4" />
                                  Start Camera
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <img
                              src={capturedPhoto}
                              alt="Captured face"
                              className="w-full rounded-lg"
                            />
                            <Button 
                              onClick={retakePhoto} 
                              variant="outline" 
                              className="w-full gap-2"
                            >
                              <RefreshCw className="h-4 w-4" />
                              Retake Photo
                            </Button>
                          </div>
                        )}
                        <canvas ref={canvasRef} className="hidden" />
                      </div>
                    </div>
                  </div>

                  {/* Success/Error Message */}
                  {registrationMessage && (
                    <div className={`mt-4 p-4 rounded-lg ${
                      registrationSuccess 
                        ? 'bg-green-100 text-green-800 border border-green-300' 
                        : 'bg-red-100 text-red-800 border border-red-300'
                    }`}>
                      <div className="flex items-center gap-2">
                        {registrationSuccess ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : (
                          <AlertCircle className="h-5 w-5" />
                        )}
                        {registrationMessage}
                      </div>
                    </div>
                  )}

                  {/* Register Button */}
                  <div className="mt-6 flex justify-end">
                    <Button 
                      onClick={registerAppraiser} 
                      disabled={savingAppraiser}
                      className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {savingAppraiser ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Registering...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          Register Appraiser
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Bank Add/Edit Modal */}
      {showBankModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-blue-200">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-gray-900">
                  {editingBank ? 'Edit Bank' : 'Add New Bank'}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={closeBankModal} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-700">Bank Name *</Label>
                  <Input
                    value={bankForm.bank_name}
                    onChange={(e) => handleBankFormChange('bank_name', e.target.value)}
                    placeholder="Enter bank name"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Bank Code *</Label>
                  <Input
                    value={bankForm.bank_code}
                    onChange={(e) => handleBankFormChange('bank_code', e.target.value)}
                    placeholder="e.g., HDFC"
                    disabled={!!editingBank}
                    className="bg-white border-blue-200 text-gray-900 disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Short Name</Label>
                  <Input
                    value={bankForm.bank_short_name}
                    onChange={(e) => handleBankFormChange('bank_short_name', e.target.value)}
                    placeholder="e.g., HDFC Bank"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">RBI License Number</Label>
                  <Input
                    value={bankForm.rbi_license_number}
                    onChange={(e) => handleBankFormChange('rbi_license_number', e.target.value)}
                    placeholder="License number"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-gray-700">Headquarters Address</Label>
                  <Input
                    value={bankForm.headquarters_address}
                    onChange={(e) => handleBankFormChange('headquarters_address', e.target.value)}
                    placeholder="Full address"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Contact Email</Label>
                  <Input
                    type="email"
                    value={bankForm.contact_email}
                    onChange={(e) => handleBankFormChange('contact_email', e.target.value)}
                    placeholder="bank@example.com"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Contact Phone</Label>
                  <Input
                    value={bankForm.contact_phone}
                    onChange={(e) => handleBankFormChange('contact_phone', e.target.value)}
                    placeholder="Phone number"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-blue-200">
                <Button variant="outline" onClick={closeBankModal} className="border-blue-300 text-blue-700 hover:bg-blue-50">
                  Cancel
                </Button>
                <Button onClick={saveBank} disabled={savingBank} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  {savingBank ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {editingBank ? 'Update Bank' : 'Create Bank'}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Branch Add/Edit Modal */}
      {showBranchModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-blue-200">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-gray-900">
                  {editingBranch ? 'Edit Branch' : 'Add New Branch'}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={closeBranchModal} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-gray-700">Bank *</Label>
                  <select
                    value={branchForm.bank_id}
                    onChange={(e) => handleBranchFormChange('bank_id', e.target.value ? Number(e.target.value) : '')}
                    disabled={!!editingBranch}
                    className="w-full px-3 py-2 bg-white border border-blue-200 rounded-md text-gray-900 disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select Bank</option>
                    {banks.map(bank => (
                      <option key={bank.id} value={bank.id}>{bank.bank_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Branch Name *</Label>
                  <Input
                    value={branchForm.branch_name}
                    onChange={(e) => handleBranchFormChange('branch_name', e.target.value)}
                    placeholder="Enter branch name"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Branch Code *</Label>
                  <Input
                    value={branchForm.branch_code}
                    onChange={(e) => handleBranchFormChange('branch_code', e.target.value)}
                    placeholder="e.g., BR001"
                    disabled={!!editingBranch}
                    className="bg-white border-blue-200 text-gray-900 disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-gray-700">Address</Label>
                  <Input
                    value={branchForm.branch_address}
                    onChange={(e) => handleBranchFormChange('branch_address', e.target.value)}
                    placeholder="Full address"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">City</Label>
                  <Input
                    value={branchForm.branch_city}
                    onChange={(e) => handleBranchFormChange('branch_city', e.target.value)}
                    placeholder="City"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">State</Label>
                  <Input
                    value={branchForm.branch_state}
                    onChange={(e) => handleBranchFormChange('branch_state', e.target.value)}
                    placeholder="State"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Pincode</Label>
                  <Input
                    value={branchForm.branch_pincode}
                    onChange={(e) => handleBranchFormChange('branch_pincode', e.target.value)}
                    placeholder="6-digit pincode"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Manager Name</Label>
                  <Input
                    value={branchForm.manager_name}
                    onChange={(e) => handleBranchFormChange('manager_name', e.target.value)}
                    placeholder="Branch manager"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Contact Email</Label>
                  <Input
                    type="email"
                    value={branchForm.contact_email}
                    onChange={(e) => handleBranchFormChange('contact_email', e.target.value)}
                    placeholder="branch@bank.com"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-blue-600">Used for Branch Admin login</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Contact Phone</Label>
                  <Input
                    value={branchForm.contact_phone}
                    onChange={(e) => handleBranchFormChange('contact_phone', e.target.value)}
                    placeholder="Phone number"
                    className="bg-white border-blue-200 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-blue-600">Used as Branch Admin password</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-blue-200">
                <Button variant="outline" onClick={closeBranchModal} className="border-blue-300 text-blue-700 hover:bg-blue-50">
                  Cancel
                </Button>
                <Button onClick={saveBranch} disabled={savingBranch} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  {savingBranch ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {editingBranch ? 'Update Branch' : 'Create Branch'}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bank Admin Add Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="border-b border-blue-200 bg-gradient-to-r from-blue-50 to-white">
              <div className="flex justify-between items-center">
                <CardTitle className="text-gray-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Create Bank Admin with Login Credentials
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={closeAdminModal} className="hover:bg-blue-50">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {/* Bank Selection */}
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  Bank <span className="text-red-500">*</span>
                </Label>
                <select
                  value={adminForm.bank_id}
                  onChange={(e) => handleAdminFormChange('bank_id', e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Bank</option>
                  {banks.map(bank => (
                    <option key={bank.id} value={bank.id}>
                      {bank.bank_name} ({bank.bank_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Full Name */}
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600" />
                  Full Name
                </Label>
                <Input
                  value={adminForm.full_name}
                  onChange={(e) => handleAdminFormChange('full_name', e.target.value)}
                  placeholder="Enter admin full name"
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-600" />
                  Email (Login Username) <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => handleAdminFormChange('email', e.target.value)}
                  placeholder="admin@bank.com"
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500">This email will be used for login and password reset</p>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-600" />
                  Password <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={adminForm.password}
                    onChange={(e) => handleAdminFormChange('password', e.target.value)}
                    placeholder="Enter secure password"
                    className="w-full px-4 py-3 pr-12 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">Minimum 8 characters. Admin can reset via "Forgot Password"</p>
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-600" />
                  Phone Number
                </Label>
                <Input
                  type="tel"
                  value={adminForm.phone}
                  onChange={(e) => handleAdminFormChange('phone', e.target.value)}
                  placeholder="Enter phone number"
                  className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex gap-2">
                  <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Login Credentials</p>
                    <p className="text-xs text-blue-700 mt-1">
                      The bank admin will use the email and password to login at <strong>/admin</strong> page. 
                      They can reset their password using the "Forgot Password" feature.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-blue-200">
                <Button
                  variant="outline"
                  onClick={closeAdminModal}
                  className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                  disabled={savingAdmin}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveAdmin}
                  disabled={savingAdmin || !adminForm.bank_id || !adminForm.email || !adminForm.password}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  {savingAdmin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Create Bank Admin
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Branch Admin Add Modal */}
      {showBranchAdminModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md bg-white border-blue-200">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-gray-900">Add Branch Administrator</CardTitle>
                <Button variant="ghost" size="sm" onClick={closeBranchAdminModal} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ba_bank">Bank *</Label>
                <select
                  id="ba_bank"
                  value={branchAdminForm.bank_id}
                  onChange={(e) => handleBranchAdminFormChange('bank_id', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Bank</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id.toString()}>
                      {bank.bank_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ba_branch">Branch *</Label>
                <select
                  id="ba_branch"
                  value={branchAdminForm.branch_id}
                  onChange={(e) => handleBranchAdminFormChange('branch_id', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={!branchAdminForm.bank_id}
                >
                  <option value="">{branchAdminForm.bank_id ? 'Select Branch' : 'Select bank first'}</option>
                  {filteredBranchesForAdmin.map((branch) => (
                    <option key={branch.id} value={branch.id.toString()}>
                      {branch.branch_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ba_full_name">Full Name *</Label>
                <Input
                  id="ba_full_name"
                  value={branchAdminForm.full_name}
                  onChange={(e) => handleBranchAdminFormChange('full_name', e.target.value)}
                  placeholder="Enter full name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ba_email">Email *</Label>
                <Input
                  id="ba_email"
                  type="email"
                  value={branchAdminForm.email}
                  onChange={(e) => handleBranchAdminFormChange('email', e.target.value)}
                  placeholder="Enter email address"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ba_password">Password *</Label>
                <div className="relative">
                  <Input
                    id="ba_password"
                    type={showBranchAdminPassword ? "text" : "password"}
                    value={branchAdminForm.password}
                    onChange={(e) => handleBranchAdminFormChange('password', e.target.value)}
                    placeholder="Enter password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowBranchAdminPassword(!showBranchAdminPassword)}
                  >
                    {showBranchAdminPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ba_phone">Phone</Label>
                <Input
                  id="ba_phone"
                  value={branchAdminForm.phone}
                  onChange={(e) => handleBranchAdminFormChange('phone', e.target.value)}
                  placeholder="Enter phone number (optional)"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={closeBranchAdminModal}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveBranchAdmin} 
                  disabled={savingBranchAdmin}
                  className="bg-blue-600 hover:bg-blue-700 gap-2"
                >
                  {savingBranchAdmin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Create Branch Admin
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default SuperAdmin;
