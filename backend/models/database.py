import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from datetime import datetime
from typing import Optional, List, Dict, Any
import json
import os
from dotenv import load_dotenv

load_dotenv()

# Global connection pool - initialized once at startup
_connection_pool: Optional[pool.ThreadedConnectionPool] = None
_db_initialized: bool = False

def get_connection_pool():
    """Get or create the global connection pool"""
    global _connection_pool
    
    if _connection_pool is not None:
        return _connection_pool
    
    load_dotenv(override=True)
    
    host = os.getenv('DB_HOST', '').strip()
    database_url = os.getenv('DATABASE_URL', '').strip()
    
    connection_string = None
    connection_params = None
    
    if host:
        connection_params = {
            'host': host,
            'port': os.getenv('DB_PORT', '5432').strip(),
            'database': os.getenv('DB_NAME', 'postgres').strip(),
            'user': os.getenv('DB_USER', 'postgres').strip(),
            'password': os.getenv('DB_PASSWORD', '').strip(),
        }
        if "supabase" in host.lower():
            connection_params['sslmode'] = 'require'
    elif database_url:
        connection_string = database_url.replace('postgresql+psycopg2://', 'postgresql://')
        if "supabase" in connection_string.lower() and "sslmode" not in connection_string:
            sep = "&" if "?" in connection_string else "?"
            connection_string += f"{sep}sslmode=require"
    else:
        connection_string = "postgresql://postgres:admin@localhost:5432/gold_loan_appraisal"
    
    # Create threaded connection pool with min 2 and max 20 connections
    if connection_params:
        _connection_pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            **connection_params
        )
    else:
        _connection_pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            dsn=connection_string
        )
    
    return _connection_pool

class Database:
    def __init__(self, skip_init: bool = False):
        """Initialize Database connection (Supabase/PostgreSQL)
        
        Args:
            skip_init: If True, skip database initialization (for regular requests)
        """
        global _db_initialized
        
        self._pool = get_connection_pool()
        
        # Only initialize database once at startup
        if not skip_init and not _db_initialized:
            self._init_connection_params()
            self.init_database()
            _db_initialized = True
    
    def _init_connection_params(self):
        """Initialize connection parameters for compatibility"""
        load_dotenv(override=True)
        
        host = os.getenv('DB_HOST', '').strip()
        database_url = os.getenv('DATABASE_URL', '').strip()
        
        if host:
            self.connection_string = None
            self.connection_params = {
                'host': host,
                'port': os.getenv('DB_PORT', '5432').strip(),
                'database': os.getenv('DB_NAME', 'postgres').strip(),
                'user': os.getenv('DB_USER', 'postgres').strip(),
                'password': os.getenv('DB_PASSWORD', '').strip(),
            }
            if "supabase" in host.lower():
                self.connection_params['sslmode'] = 'require'
        elif database_url:
            self.connection_string = database_url.replace('postgresql+psycopg2://', 'postgresql://')
            if "supabase" in self.connection_string.lower() and "sslmode" not in self.connection_string:
                sep = "&" if "?" in self.connection_string else "?"
                self.connection_string += f"{sep}sslmode=require"
            self.connection_params = None
        else:
            self.connection_string = "postgresql://postgres:admin@localhost:5432/gold_loan_appraisal"
            self.connection_params = None
    
    def get_connection(self):
        """Get a connection from the pool with validation"""
        max_attempts = 3
        
        for attempt in range(max_attempts):
            try:
                conn = self._pool.getconn()
                # Validate connection is healthy
                try:
                    cursor = conn.cursor()
                    cursor.execute("SELECT 1")
                    cursor.close()
                    return conn  # Connection is valid
                except Exception:
                    # Connection is stale, close and try again
                    try:
                        self._pool.putconn(conn, close=True)
                    except Exception:
                        pass
                    if attempt == max_attempts - 1:
                        raise RuntimeError("No healthy database connection available after retries")
                    continue
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"Failed to get database connection (attempt {attempt + 1}/{max_attempts}): {e}")
                if attempt == max_attempts - 1:
                    raise
    
    def return_connection(self, conn, close: bool = False):
        """Return a connection to the pool safely"""
        try:
            if conn:
                # Check if connection is still usable
                if conn.closed:
                    return  # Already closed, nothing to do
                self._pool.putconn(conn, close=close)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Error returning connection to pool: {e}")
    
    def close(self):
        """Close all connections in the pool"""
        global _connection_pool
        try:
            if self._pool:
                self._pool.closeall()
                _connection_pool = None
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Error closing connection pool: {e}")
    
    def test_connection(self) -> bool:
        """Test if database connection is working"""
        conn = None
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            return True
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Database connection test failed: {e}")
            return False
        finally:
            if conn:
                self.return_connection(conn)
    
    def reset_database(self):
        """Reset database by dropping all known tables"""
        global _db_initialized
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            tables = [
                "appraiser_details", "customer_details", "rbi_compliance_details", 
                "purity_test_details", "overall_sessions", 
                "appraisers", "appraisals", "appraisal_sessions" 
            ]
            for table in tables:
                cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            conn.commit()
            print("Database reset successfully.")
            _db_initialized = False  # Allow re-initialization
            self.init_database()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def init_database(self):
        """Initialize database tables with new schema including tenant hierarchy"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # 0. Tenant Hierarchy Tables
            
            # Banks (Top-level tenants)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS banks (
                    id SERIAL PRIMARY KEY,
                    bank_code VARCHAR(20) UNIQUE NOT NULL,
                    bank_name VARCHAR(255) NOT NULL,
                    bank_short_name VARCHAR(50),
                    headquarters_address TEXT,
                    contact_email VARCHAR(255),
                    contact_phone VARCHAR(20),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* Compliance and Configuration */
                    rbi_license_number VARCHAR(50),
                    regulatory_compliance JSONB DEFAULT '{}',
                    system_configuration JSONB DEFAULT '{}',
                    
                    /* Tenant Isolation */
                    tenant_settings JSONB DEFAULT '{}'
                )
            ''')
            
            # Branches (Sub-tenants under banks)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS branches (
                    id SERIAL PRIMARY KEY,
                    bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
                    branch_code VARCHAR(20) NOT NULL,
                    branch_name VARCHAR(255) NOT NULL,
                    branch_address TEXT,
                    branch_city VARCHAR(100),
                    branch_state VARCHAR(100),
                    branch_pincode VARCHAR(10),
                    contact_email VARCHAR(255),
                    contact_phone VARCHAR(20),
                    manager_name VARCHAR(255),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* GPS and Location */
                    latitude DECIMAL(10, 8),
                    longitude DECIMAL(11, 8),
                    
                    /* Branch-specific Configuration */
                    branch_settings JSONB DEFAULT '{}',
                    operational_hours JSONB DEFAULT '{}',
                    
                    UNIQUE(bank_id, branch_code)
                )
            ''')
            
            # Tenant Users/Appraisers with hierarchy
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS tenant_users (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(50) NOT NULL,
                    bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
                    branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
                    
                    /* User Information */
                    full_name VARCHAR(255) NOT NULL,
                    email VARCHAR(255),
                    phone VARCHAR(20),
                    employee_id VARCHAR(50),
                    designation VARCHAR(100),
                    
                    /* Authentication */
                    face_encoding TEXT,
                    image_data TEXT,
                    
                    /* Permissions and Roles */
                    user_role VARCHAR(50) DEFAULT 'appraiser',
                    permissions JSONB DEFAULT '{}',
                    
                    /* Status */
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP,
                    
                    UNIQUE(bank_id, user_id),
                    UNIQUE(bank_id, employee_id)
                )
            ''')
            
            # Create indexes for performance
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_banks_code ON banks(bank_code)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_branches_bank_code ON branches(bank_id, branch_code)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_tenant_users_bank_user ON tenant_users(bank_id, user_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_tenant_users_branch ON tenant_users(branch_id)')
            
            # Branch Admins Table - Dedicated table for branch administrators
            # Provides structural separation and explicit permission scoping
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS branch_admins (
                    id SERIAL PRIMARY KEY,
                    bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                    
                    /* Admin Information */
                    admin_id VARCHAR(50) NOT NULL,
                    full_name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    phone VARCHAR(20),
                    
                    /* Authentication - Password hash stored in password_hash field */
                    password_hash TEXT NOT NULL,
                    
                    /* Permissions - Branch-specific permissions only */
                    permissions JSONB DEFAULT '{}',
                    
                    /* Status */
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP,
                    created_by INTEGER,  -- References user who created this admin
                    
                    /* Constraints */
                    UNIQUE(bank_id, branch_id, email),
                    UNIQUE(bank_id, branch_id, admin_id)
                    
                    /* Note: Branch-bank relationship validated by foreign keys and application logic */
                )
            ''')
            
            # Create indexes for branch_admins
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_branch_admins_bank ON branch_admins(bank_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_branch_admins_branch ON branch_admins(branch_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_branch_admins_email ON branch_admins(email)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_branch_admins_active ON branch_admins(is_active) WHERE is_active = true')
            
            # Appraiser Bank Branch Mapping Table - For multi-bank/branch support
            # An appraiser can be mapped to multiple bank/branch combinations
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS appraiser_bank_branch_map (
                    id SERIAL PRIMARY KEY,
                    appraiser_id TEXT NOT NULL,  -- References overall_sessions.appraiser_id where status='registered'
                    bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    UNIQUE(appraiser_id, bank_id, branch_id)
                )
            ''')
            
            # Create indexes for appraiser mapping
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_appraiser_map_appraiser ON appraiser_bank_branch_map(appraiser_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_appraiser_map_bank_branch ON appraiser_bank_branch_map(bank_id, branch_id)')
            
            # 1. Overall Sessions (Master Table) - Updated with tenant hierarchy
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS overall_sessions (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'in_progress',
                    
                    /* Tenant Hierarchy - New columns for multi-tenant support */
                    bank_id INTEGER,
                    branch_id INTEGER,
                    tenant_user_id INTEGER,
                    
                    /* Common Fields (Redundant - for backward compatibility) */
                    name TEXT,
                    bank TEXT,
                    branch TEXT,
                    email TEXT,
                    phone TEXT,
                    appraiser_id TEXT,
                    image_data TEXT,
                    face_encoding TEXT  /* For persistent recognition */
                )
            ''')
            
            # Add tenant columns if they don't exist (for existing databases)
            cursor.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='bank_id') THEN
                        ALTER TABLE overall_sessions ADD COLUMN bank_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='branch_id') THEN
                        ALTER TABLE overall_sessions ADD COLUMN branch_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='tenant_user_id') THEN
                        ALTER TABLE overall_sessions ADD COLUMN tenant_user_id INTEGER;
                    END IF;
                END $$;
            ''')

            # 2. Appraiser Details - Updated with tenant hierarchy
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS appraiser_details (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES overall_sessions(session_id) ON DELETE CASCADE,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* Tenant Hierarchy - Foreign keys added later */
                    bank_id INTEGER,
                    branch_id INTEGER, 
                    tenant_user_id INTEGER,
                    
                    /* Legacy Fields - for backward compatibility */
                    name TEXT,
                    bank TEXT,
                    branch TEXT,
                    email TEXT,
                    phone TEXT,
                    appraiser_id TEXT,
                    image_data TEXT,
                    face_encoding TEXT
                )
            ''')
            
            # Add tenant columns to appraiser_details if they don't exist
            cursor.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='bank_id') THEN
                        ALTER TABLE appraiser_details ADD COLUMN bank_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='branch_id') THEN
                        ALTER TABLE appraiser_details ADD COLUMN branch_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='tenant_user_id') THEN
                        ALTER TABLE appraiser_details ADD COLUMN tenant_user_id INTEGER;
                    END IF;
                END $$;
            ''')

            # 3. Customer Details - Updated with tenant context
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS customer_details (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES overall_sessions(session_id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* Tenant Context - Foreign keys added later */
                    bank_id INTEGER,
                    branch_id INTEGER,
                    
                    /* Customer Information */
                    customer_image TEXT,
                    customer_name VARCHAR(255),
                    customer_id VARCHAR(100),
                    customer_phone VARCHAR(20),
                    customer_address TEXT,
                    
                    /* Legacy Fields - for backward compatibility */
                    name TEXT,
                    bank TEXT,
                    branch TEXT,
                    email TEXT,
                    phone TEXT,
                    appraiser_id TEXT,
                    image_data TEXT
                )
            ''')
            
            # Add tenant columns to customer_details if they don't exist
            cursor.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='customer_details' AND column_name='bank_id') THEN
                        ALTER TABLE customer_details ADD COLUMN bank_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='customer_details' AND column_name='branch_id') THEN
                        ALTER TABLE customer_details ADD COLUMN branch_id INTEGER;
                    END IF;
                END $$;
            ''')

            # 4. RBI Compliance Details - Updated with tenant context
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS rbi_compliance_details (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES overall_sessions(session_id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* Tenant Context - Foreign keys added later */
                    bank_id INTEGER,
                    branch_id INTEGER,
                    
                    /* RBI Compliance Specific Fields */
                    total_items INTEGER DEFAULT 0,
                    overall_images TEXT, 
                    item_images TEXT,    
                    gps_coords TEXT,
                    compliance_checklist JSONB DEFAULT '{}',
                    regulatory_notes TEXT,
                    
                    /* Legacy Fields - for backward compatibility */
                    name TEXT,
                    bank TEXT,
                    branch TEXT,
                    email TEXT,
                    phone TEXT,
                    appraiser_id TEXT,
                    image_data TEXT
                )
            ''')
            
            # Add tenant columns to rbi_compliance_details if they don't exist
            cursor.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='rbi_compliance_details' AND column_name='bank_id') THEN
                        ALTER TABLE rbi_compliance_details ADD COLUMN bank_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='rbi_compliance_details' AND column_name='branch_id') THEN
                        ALTER TABLE rbi_compliance_details ADD COLUMN branch_id INTEGER;
                    END IF;
                END $$;
            ''')

            # 5. Purity Test Details - Updated with tenant context
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS purity_test_details (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES overall_sessions(session_id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    /* Tenant Context - Foreign keys added later */
                    bank_id INTEGER,
                    branch_id INTEGER,
                    
                    /* Purity Test Specific Fields */
                    total_items INTEGER DEFAULT 0,
                    results TEXT,
                    test_method VARCHAR(50),
                    quality_parameters JSONB DEFAULT '{}',
                    certification_data JSONB DEFAULT '{}',
                    
                    /* Legacy Fields - for backward compatibility */
                    name TEXT,
                    bank TEXT,
                    branch TEXT,
                    email TEXT,
                    phone TEXT,
                    appraiser_id TEXT,
                    image_data TEXT
                )
            ''')
            
            # Add tenant columns to purity_test_details if they don't exist
            cursor.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='purity_test_details' AND column_name='bank_id') THEN
                        ALTER TABLE purity_test_details ADD COLUMN bank_id INTEGER;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='purity_test_details' AND column_name='branch_id') THEN
                        ALTER TABLE purity_test_details ADD COLUMN branch_id INTEGER;
                    END IF;
                END $$;
            ''')
            
            # Create additional indexes for tenant-based queries (safely)
            # Only create indexes if columns exist
            cursor.execute('''
                DO $$
                BEGIN
                    -- Check and create indexes for overall_sessions
                    IF EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='overall_sessions' AND column_name='bank_id') THEN
                        CREATE INDEX IF NOT EXISTS idx_overall_sessions_bank_id ON overall_sessions(bank_id);
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='overall_sessions' AND column_name='branch_id') THEN
                        CREATE INDEX IF NOT EXISTS idx_overall_sessions_branch_id ON overall_sessions(branch_id);
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='overall_sessions' AND column_name='tenant_user_id') THEN
                        CREATE INDEX IF NOT EXISTS idx_overall_sessions_tenant_user ON overall_sessions(tenant_user_id);
                    END IF;
                    
                    -- Create indexes for other tables (these should have the columns)
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='appraiser_details') THEN
                        CREATE INDEX IF NOT EXISTS idx_appraiser_details_bank_id ON appraiser_details(bank_id);
                        CREATE INDEX IF NOT EXISTS idx_appraiser_details_tenant_user ON appraiser_details(tenant_user_id);
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customer_details') THEN
                        CREATE INDEX IF NOT EXISTS idx_customer_details_bank_id ON customer_details(bank_id);
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rbi_compliance_details') THEN
                        CREATE INDEX IF NOT EXISTS idx_rbi_compliance_bank_id ON rbi_compliance_details(bank_id);
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='purity_test_details') THEN
                        CREATE INDEX IF NOT EXISTS idx_purity_test_bank_id ON purity_test_details(bank_id);
                    END IF;
                END $$;
            ''')
            
            # Add foreign key constraints safely (only if tenant tables exist)
            cursor.execute('''
                DO $$
                BEGIN
                    -- Add foreign key constraints for overall_sessions if tenant tables exist
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='banks') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='bank_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='overall_sessions' AND constraint_name='fk_overall_sessions_bank') THEN
                            ALTER TABLE overall_sessions ADD CONSTRAINT fk_overall_sessions_bank 
                                FOREIGN KEY (bank_id) REFERENCES banks(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='branches') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='branch_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='overall_sessions' AND constraint_name='fk_overall_sessions_branch') THEN
                            ALTER TABLE overall_sessions ADD CONSTRAINT fk_overall_sessions_branch 
                                FOREIGN KEY (branch_id) REFERENCES branches(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_users') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='overall_sessions' AND column_name='tenant_user_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='overall_sessions' AND constraint_name='fk_overall_sessions_tenant_user') THEN
                            ALTER TABLE overall_sessions ADD CONSTRAINT fk_overall_sessions_tenant_user 
                                FOREIGN KEY (tenant_user_id) REFERENCES tenant_users(id);
                        END IF;
                    END IF;
                    
                    -- Add foreign key constraints for appraiser_details
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='banks') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='bank_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='appraiser_details' AND constraint_name='fk_appraiser_details_bank') THEN
                            ALTER TABLE appraiser_details ADD CONSTRAINT fk_appraiser_details_bank 
                                FOREIGN KEY (bank_id) REFERENCES banks(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='branches') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='branch_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='appraiser_details' AND constraint_name='fk_appraiser_details_branch') THEN
                            ALTER TABLE appraiser_details ADD CONSTRAINT fk_appraiser_details_branch 
                                FOREIGN KEY (branch_id) REFERENCES branches(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_users') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='appraiser_details' AND column_name='tenant_user_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='appraiser_details' AND constraint_name='fk_appraiser_details_tenant_user') THEN
                            ALTER TABLE appraiser_details ADD CONSTRAINT fk_appraiser_details_tenant_user 
                                FOREIGN KEY (tenant_user_id) REFERENCES tenant_users(id);
                        END IF;
                    END IF;
                    
                    -- Add foreign key constraints for customer_details
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='banks') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='customer_details' AND column_name='bank_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='customer_details' AND constraint_name='fk_customer_details_bank') THEN
                            ALTER TABLE customer_details ADD CONSTRAINT fk_customer_details_bank 
                                FOREIGN KEY (bank_id) REFERENCES banks(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='branches') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='customer_details' AND column_name='branch_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='customer_details' AND constraint_name='fk_customer_details_branch') THEN
                            ALTER TABLE customer_details ADD CONSTRAINT fk_customer_details_branch 
                                FOREIGN KEY (branch_id) REFERENCES branches(id);
                        END IF;
                    END IF;
                    
                    -- Add foreign key constraints for rbi_compliance_details
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='banks') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='rbi_compliance_details' AND column_name='bank_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='rbi_compliance_details' AND constraint_name='fk_rbi_compliance_details_bank') THEN
                            ALTER TABLE rbi_compliance_details ADD CONSTRAINT fk_rbi_compliance_details_bank 
                                FOREIGN KEY (bank_id) REFERENCES banks(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='branches') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='rbi_compliance_details' AND column_name='branch_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='rbi_compliance_details' AND constraint_name='fk_rbi_compliance_details_branch') THEN
                            ALTER TABLE rbi_compliance_details ADD CONSTRAINT fk_rbi_compliance_details_branch 
                                FOREIGN KEY (branch_id) REFERENCES branches(id);
                        END IF;
                    END IF;
                    
                    -- Add foreign key constraints for purity_test_details
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='banks') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='purity_test_details' AND column_name='bank_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='purity_test_details' AND constraint_name='fk_purity_test_details_bank') THEN
                            ALTER TABLE purity_test_details ADD CONSTRAINT fk_purity_test_details_bank 
                                FOREIGN KEY (bank_id) REFERENCES banks(id);
                        END IF;
                    END IF;
                    
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='branches') 
                       AND EXISTS (SELECT 1 FROM information_schema.columns 
                                  WHERE table_name='purity_test_details' AND column_name='branch_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                                      WHERE table_name='purity_test_details' AND constraint_name='fk_purity_test_details_branch') THEN
                            ALTER TABLE purity_test_details ADD CONSTRAINT fk_purity_test_details_branch 
                                FOREIGN KEY (branch_id) REFERENCES branches(id);
                        END IF;
                    END IF;
                END $$;
            ''')
            
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise
        finally:
            cursor.close()
            self.return_connection(conn)

    # =========================================================================
    # Tenant Management Methods
    # =========================================================================
    
    def create_bank(self, bank_code: str, bank_name: str, bank_short_name: str = None,
                    headquarters_address: str = None, contact_email: str = None,
                    contact_phone: str = None, rbi_license_number: str = None,
                    system_configuration: Dict = None, tenant_settings: Dict = None) -> int:
        """Create a new bank (top-level tenant)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO banks (
                    bank_code, bank_name, bank_short_name, headquarters_address,
                    contact_email, contact_phone, rbi_license_number,
                    system_configuration, tenant_settings
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                bank_code, bank_name, bank_short_name, headquarters_address,
                contact_email, contact_phone, rbi_license_number,
                json.dumps(system_configuration or {}), json.dumps(tenant_settings or {})
            ))
            bank_id = cursor.fetchone()[0]
            conn.commit()
            return bank_id
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def create_branch(self, bank_id: int, branch_code: str, branch_name: str,
                      branch_address: str = None, branch_city: str = None,
                      branch_state: str = None, branch_pincode: str = None,
                      contact_email: str = None, contact_phone: str = None,
                      manager_name: str = None, latitude: float = None,
                      longitude: float = None, branch_settings: Dict = None,
                      operational_hours: Dict = None) -> int:
        """Create a new branch under a bank"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO branches (
                    bank_id, branch_code, branch_name, branch_address,
                    branch_city, branch_state, branch_pincode, contact_email,
                    contact_phone, manager_name, latitude, longitude,
                    branch_settings, operational_hours
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                bank_id, branch_code, branch_name, branch_address,
                branch_city, branch_state, branch_pincode, contact_email,
                contact_phone, manager_name, latitude, longitude,
                json.dumps(branch_settings or {}), json.dumps(operational_hours or {})
            ))
            branch_id = cursor.fetchone()[0]
            conn.commit()
            return branch_id
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def create_tenant_user(self, user_id: str, bank_id: int, branch_id: int = None,
                          full_name: str = None, email: str = None, phone: str = None,
                          employee_id: str = None, designation: str = None,
                          face_encoding: str = None, image_data: str = None,
                          user_role: str = 'appraiser', permissions: Dict = None) -> int:
        """Create a new tenant user (appraiser/employee)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO tenant_users (
                    user_id, bank_id, branch_id, full_name, email, phone,
                    employee_id, designation, face_encoding, image_data,
                    user_role, permissions
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                user_id, bank_id, branch_id, full_name, email, phone,
                employee_id, designation, face_encoding, image_data,
                user_role, json.dumps(permissions or {})
            ))
            tenant_user_id = cursor.fetchone()[0]
            conn.commit()
            return tenant_user_id
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_bank_by_code(self, bank_code: str) -> Optional[Dict[str, Any]]:
        """Get bank details by bank code"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM banks WHERE bank_code = %s AND is_active = true", (bank_code,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branch_by_code(self, bank_id: int, branch_code: str) -> Optional[Dict[str, Any]]:
        """Get branch details by bank_id and branch code"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT b.*, bank.bank_name, bank.bank_code 
                FROM branches b
                JOIN banks bank ON b.bank_id = bank.id
                WHERE b.bank_id = %s AND b.branch_code = %s AND b.is_active = true
            ''', (bank_id, branch_code))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_tenant_user_by_id(self, bank_id: int, user_id: str) -> Optional[Dict[str, Any]]:
        """Get tenant user by bank_id and user_id"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT tu.*, b.bank_name, b.bank_code, br.branch_name, br.branch_code
                FROM tenant_users tu
                JOIN banks b ON tu.bank_id = b.id
                LEFT JOIN branches br ON tu.branch_id = br.id
                WHERE tu.bank_id = %s AND tu.user_id = %s AND tu.is_active = true
            ''', (bank_id, user_id))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_all_banks(self) -> List[Dict[str, Any]]:
        """Get all active banks"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM banks WHERE is_active = true ORDER BY bank_name")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branches_by_bank(self, bank_id: int) -> List[Dict[str, Any]]:
        """Get all branches for a specific bank"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT b.*, bank.bank_name, bank.bank_code
                FROM branches b
                JOIN banks bank ON b.bank_id = bank.id
                WHERE b.bank_id = %s AND b.is_active = true
                ORDER BY b.branch_name
            ''', (bank_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_tenant_users_by_bank(self, bank_id: int) -> List[Dict[str, Any]]:
        """Get all users for a specific bank"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT tu.*, b.bank_name, b.bank_code, br.branch_name, br.branch_code
                FROM tenant_users tu
                JOIN banks b ON tu.bank_id = b.id
                LEFT JOIN branches br ON tu.branch_id = br.id
                WHERE tu.bank_id = %s AND tu.is_active = true
                ORDER BY tu.full_name
            ''', (bank_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_tenant_users_by_branch(self, branch_id: int) -> List[Dict[str, Any]]:
        """Get all users for a specific branch"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT tu.*, b.bank_name, b.bank_code, br.branch_name, br.branch_code
                FROM tenant_users tu
                JOIN banks b ON tu.bank_id = b.id
                JOIN branches br ON tu.branch_id = br.id
                WHERE tu.branch_id = %s AND tu.is_active = true
                ORDER BY tu.full_name
            ''', (branch_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    # =========================================================================
    # Branch Admin Management Methods
    # =========================================================================
    
    def create_branch_admin(self, bank_id: int, branch_id: int, admin_id: str,
                           full_name: str, email: str, password_hash: str,
                           phone: str = None, permissions: Dict = None,
                           created_by: int = None) -> int:
        """
        Create a new branch admin with exclusive access to their branch.
        
        Args:
            bank_id: ID of the bank
            branch_id: ID of the branch (must belong to the bank)
            admin_id: Unique identifier for the admin
            full_name: Full name of the admin
            email: Email address (must be unique per bank/branch)
            password_hash: Hashed password for authentication
            phone: Phone number (optional)
            permissions: Branch-specific permissions (optional)
            created_by: ID of user who created this admin (optional)
            
        Returns:
            ID of the created branch admin
            
        Raises:
            Exception: If branch doesn't belong to bank or duplicate admin exists
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            # Verify branch belongs to bank
            cursor.execute('''
                SELECT 1 FROM branches 
                WHERE id = %s AND bank_id = %s AND is_active = true
            ''', (branch_id, bank_id))
            
            if not cursor.fetchone():
                raise ValueError(f"Branch {branch_id} does not belong to bank {bank_id} or is inactive")
            
            # Create branch admin
            cursor.execute('''
                INSERT INTO branch_admins (
                    bank_id, branch_id, admin_id, full_name, email, phone,
                    password_hash, permissions, created_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                bank_id, branch_id, admin_id, full_name, email, phone,
                password_hash, json.dumps(permissions or {}), created_by
            ))
            
            admin_id_result = cursor.fetchone()[0]
            conn.commit()
            return admin_id_result
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branch_admin_by_email(self, email: str, bank_id: int = None, 
                                  branch_id: int = None) -> Optional[Dict[str, Any]]:
        """
        Get branch admin by email with optional bank/branch filtering.
        Used for authentication and authorization.
        """
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            query = '''
                SELECT ba.*, 
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code
                FROM branch_admins ba
                JOIN banks b ON ba.bank_id = b.id
                JOIN branches br ON ba.branch_id = br.id
                WHERE ba.email = %s AND ba.is_active = true
            '''
            params = [email]
            
            if bank_id:
                query += ' AND ba.bank_id = %s'
                params.append(bank_id)
            
            if branch_id:
                query += ' AND ba.branch_id = %s'
                params.append(branch_id)
            
            cursor.execute(query, params)
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branch_admin_by_id(self, admin_id: int) -> Optional[Dict[str, Any]]:
        """Get branch admin by ID"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT ba.*, 
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code
                FROM branch_admins ba
                JOIN banks b ON ba.bank_id = b.id
                JOIN branches br ON ba.branch_id = br.id
                WHERE ba.id = %s
            ''', (admin_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branch_admins_by_bank(self, bank_id: int) -> List[Dict[str, Any]]:
        """Get all branch admins for a specific bank"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT ba.*, 
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code
                FROM branch_admins ba
                JOIN banks b ON ba.bank_id = b.id
                JOIN branches br ON ba.branch_id = br.id
                WHERE ba.bank_id = %s AND ba.is_active = true
                ORDER BY br.branch_name, ba.full_name
            ''', (bank_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_branch_admins_by_branch(self, branch_id: int) -> List[Dict[str, Any]]:
        """Get all admins for a specific branch"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT ba.*, 
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code
                FROM branch_admins ba
                JOIN banks b ON ba.bank_id = b.id
                JOIN branches br ON ba.branch_id = br.id
                WHERE ba.branch_id = %s AND ba.is_active = true
                ORDER BY ba.full_name
            ''', (branch_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def update_branch_admin(self, admin_id: int, 
                           full_name: str = None, email: str = None,
                           phone: str = None, password_hash: str = None,
                           permissions: Dict = None, is_active: bool = None) -> bool:
        """Update branch admin information"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            updates = []
            params = []
            
            if full_name is not None:
                updates.append("full_name = %s")
                params.append(full_name)
            
            if email is not None:
                updates.append("email = %s")
                params.append(email)
            
            if phone is not None:
                updates.append("phone = %s")
                params.append(phone)
            
            if password_hash is not None:
                updates.append("password_hash = %s")
                params.append(password_hash)
            
            if permissions is not None:
                updates.append("permissions = %s")
                params.append(json.dumps(permissions))
            
            if is_active is not None:
                updates.append("is_active = %s")
                params.append(is_active)
            
            if not updates:
                return True
            
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(admin_id)
            
            query = f"UPDATE branch_admins SET {', '.join(updates)} WHERE id = %s"
            cursor.execute(query, params)
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def delete_branch_admin(self, admin_id: int) -> bool:
        """Soft delete (deactivate) a branch admin"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                UPDATE branch_admins 
                SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                WHERE id = %s
            ''', (admin_id,))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def verify_branch_admin_access(self, admin_id: int, bank_id: int, 
                                   branch_id: int) -> bool:
        """
        Verify that a branch admin has access to the specified bank/branch.
        This is critical for authorization checks.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT 1 FROM branch_admins
                WHERE id = %s AND bank_id = %s AND branch_id = %s 
                AND is_active = true
            ''', (admin_id, bank_id, branch_id))
            return cursor.fetchone() is not None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def update_branch_admin_login(self, admin_id: int) -> None:
        """Update last login timestamp for branch admin"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                UPDATE branch_admins 
                SET last_login = CURRENT_TIMESTAMP 
                WHERE id = %s
            ''', (admin_id,))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def migrate_legacy_bank_branch_data(self):
        """Migrate existing bank/branch string data to tenant hierarchy"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Get unique bank/branch combinations from existing data
            cursor.execute('''
                SELECT DISTINCT bank, branch 
                FROM overall_sessions 
                WHERE bank IS NOT NULL AND bank != ''
                AND status = 'registered'
            ''')
            combinations = cursor.fetchall()
            
            migration_map = {}
            
            for combo in combinations:
                bank_name = combo['bank']
                branch_name = combo['branch']
                
                if not bank_name:
                    continue
                
                # Create or get bank
                bank_code = bank_name.replace(' ', '_').upper()[:20]
                cursor.execute("SELECT id FROM banks WHERE bank_code = %s", (bank_code,))
                bank_row = cursor.fetchone()
                
                if bank_row:
                    bank_id = bank_row['id']
                else:
                    bank_id = self.create_bank(
                        bank_code=bank_code,
                        bank_name=bank_name,
                        bank_short_name=bank_name[:20] if len(bank_name) > 20 else bank_name
                    )
                
                branch_id = None
                if branch_name:
                    # Create or get branch
                    branch_code = branch_name.replace(' ', '_').upper()[:20]
                    cursor.execute('''
                        SELECT id FROM branches 
                        WHERE bank_id = %s AND branch_code = %s
                    ''', (bank_id, branch_code))
                    branch_row = cursor.fetchone()
                    
                    if branch_row:
                        branch_id = branch_row['id']
                    else:
                        branch_id = self.create_branch(
                            bank_id=bank_id,
                            branch_code=branch_code,
                            branch_name=branch_name
                        )
                
                migration_map[(bank_name, branch_name)] = (bank_id, branch_id)
            
            # Update existing sessions with tenant hierarchy
            for (bank_name, branch_name), (bank_id, branch_id) in migration_map.items():
                cursor.execute('''
                    UPDATE overall_sessions 
                    SET bank_id = %s, branch_id = %s
                    WHERE bank = %s AND (branch = %s OR (%s IS NULL AND branch IS NULL))
                ''', (bank_id, branch_id, bank_name, branch_name, branch_name))
            
            conn.commit()
            return len(migration_map)
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    # =========================================================================
    # Updated Session Methods with Tenant Support
    # =========================================================================

    def create_session(self, bank_id: int = None, branch_id: int = None, 
                      tenant_user_id: int = None) -> str:
        """Create a new session in overall_sessions with tenant context"""
        import uuid
        session_id = str(uuid.uuid4())
        
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO overall_sessions (session_id, bank_id, branch_id, tenant_user_id)
                VALUES (%s, %s, %s, %s)
                RETURNING session_id
            ''', (session_id, bank_id, branch_id, tenant_user_id))
            result = cursor.fetchone()
            conn.commit()
            return result[0]
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def _get_common_info(self, cursor, session_id):
        cursor.execute('''
            SELECT os.name, os.bank, os.branch, os.email, os.phone, os.appraiser_id, os.image_data,
                   os.bank_id, os.branch_id, os.tenant_user_id,
                   b.bank_name, b.bank_code,
                   br.branch_name, br.branch_code,
                   tu.full_name, tu.user_id, tu.employee_id
            FROM overall_sessions os
            LEFT JOIN banks b ON os.bank_id = b.id
            LEFT JOIN branches br ON os.branch_id = br.id  
            LEFT JOIN tenant_users tu ON os.tenant_user_id = tu.id
            WHERE os.session_id = %s
        ''', (session_id,))
        return cursor.fetchone()

    def save_appraiser_details(self, session_id: str, data: Dict[str, Any]) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            # Extract tenant information if provided
            bank_id = data.get('bank_id')
            branch_id = data.get('branch_id')
            tenant_user_id = data.get('tenant_user_id')
            
            # If tenant IDs are provided, use them; otherwise, try to resolve from legacy data
            if not bank_id and data.get('bank'):
                bank_code = data.get('bank').replace(' ', '_').upper()[:20]
                cursor.execute("SELECT id FROM banks WHERE bank_code = %s", (bank_code,))
                bank_row = cursor.fetchone()
                if bank_row:
                    bank_id = bank_row[0]
            
            if not branch_id and data.get('branch') and bank_id:
                branch_code = data.get('branch').replace(' ', '_').upper()[:20]
                cursor.execute('''
                    SELECT id FROM branches 
                    WHERE bank_id = %s AND branch_code = %s
                ''', (bank_id, branch_code))
                branch_row = cursor.fetchone()
                if branch_row:
                    branch_id = branch_row[0]
            
            # Update overall_sessions with both legacy and new data
            cursor.execute('''
                UPDATE overall_sessions
                SET name = %s, bank = %s, branch = %s, email = %s, phone = %s, 
                    appraiser_id = %s, image_data = %s,
                    bank_id = %s, branch_id = %s, tenant_user_id = %s
                WHERE session_id = %s
            ''', (
                data.get('name'), data.get('bank'), data.get('branch'), 
                data.get('email'), data.get('phone'), data.get('id'), 
                data.get('image'), bank_id, branch_id, tenant_user_id, session_id
            ))
            
            # Insert into appraiser_details with tenant hierarchy
            cursor.execute('''
                INSERT INTO appraiser_details (
                    session_id, name, bank, branch, email, phone, appraiser_id, 
                    image_data, timestamp, bank_id, branch_id, tenant_user_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                session_id, data.get('name'), data.get('bank'), data.get('branch'), 
                data.get('email'), data.get('phone'), data.get('id'), 
                data.get('image'), data.get('timestamp') or datetime.now(),
                bank_id, branch_id, tenant_user_id
            ))
            
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def save_customer_details(self, session_id: str, data: Dict[str, Any]) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            common = self._get_common_info(cursor, session_id)
            if not common:
                raise ValueError("Session not found or Appraiser data missing")

            cursor.execute('''
                INSERT INTO customer_details (
                    session_id, customer_image, customer_name, customer_id, 
                    customer_phone, customer_address, bank_id, branch_id,
                    name, bank, branch, email, phone, appraiser_id, image_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                session_id, data.get('customer_front_image'), 
                data.get('customer_name'), data.get('customer_id'),
                data.get('customer_phone'), data.get('customer_address'),
                common['bank_id'], common['branch_id'],
                common['name'], common['bank'], common['branch'], common['email'], 
                common['phone'], common['appraiser_id'], common['image_data']
            ))
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def save_rbi_compliance(self, session_id: str, data: Dict[str, Any]) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            common = self._get_common_info(cursor, session_id)
            if not common:
                raise ValueError("Session not found")

            overall_images = json.dumps(data.get('overall_images') or []) if isinstance(data.get('overall_images'), list) else data.get('overall_images')
            item_images = json.dumps(data.get('jewellery_items') or []) if isinstance(data.get('jewellery_items'), list) else data.get('jewellery_items')
            
            cursor.execute('''
                INSERT INTO rbi_compliance_details (
                    session_id, total_items, overall_images, item_images, gps_coords,
                    compliance_checklist, regulatory_notes, bank_id, branch_id,
                    name, bank, branch, email, phone, appraiser_id, image_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                session_id, data.get('total_items'), overall_images, item_images,
                data.get('gps_coords'), json.dumps(data.get('compliance_checklist', {})),
                data.get('regulatory_notes'), common['bank_id'], common['branch_id'],
                common['name'], common['bank'], common['branch'], common['email'], 
                common['phone'], common['appraiser_id'], common['image_data']
            ))
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def save_purity_details(self, session_id: str, data: Dict[str, Any]) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            common = self._get_common_info(cursor, session_id)
            if not common:
                raise ValueError("Session not found")

            results = json.dumps(data) if isinstance(data, (dict, list)) else data
            total_items = data.get('total_items', 0) if isinstance(data, dict) else 0
            test_method = data.get('test_method', 'standard') if isinstance(data, dict) else 'standard'
            quality_parameters = json.dumps(data.get('quality_parameters', {})) if isinstance(data, dict) else '{}'
            certification_data = json.dumps(data.get('certification_data', {})) if isinstance(data, dict) else '{}'

            cursor.execute('''
                INSERT INTO purity_test_details (
                    session_id, results, total_items, test_method,
                    quality_parameters, certification_data, bank_id, branch_id,
                    name, bank, branch, email, phone, appraiser_id, image_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                session_id, results, total_items, test_method,
                quality_parameters, certification_data, 
                common['bank_id'], common['branch_id'],
                common['name'], common['bank'], common['branch'], common['email'], 
                common['phone'], common['appraiser_id'], common['image_data']
            ))
            
            cursor.execute("UPDATE overall_sessions SET status = 'purity_completed' WHERE session_id = %s", (session_id,))
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
            
    # =========================================================================
    # Compatibility Layer
    # =========================================================================
    
    def update_session_field(self, session_id: str, field: str, data: Any) -> bool:
        if field == 'appraiser_data':
            return self.save_appraiser_details(session_id, data)
        elif field == 'purity_results':
            return self.save_purity_details(session_id, data)
        elif field == 'status':
            conn = self.get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("UPDATE overall_sessions SET status = %s WHERE session_id = %s", (data, session_id))
                conn.commit()
                return True
            finally:
                cursor.close()
                self.return_connection(conn)
        return True

    def update_session_multiple(self, session_id: str, updates: Dict[str, Any]) -> bool:
        if 'customer_front_image' in updates:
            data = {'customer_front_image': updates.get('customer_front_image')}
            return self.save_customer_details(session_id, data)
        
        if 'rbi_compliance' in updates:
            rbi_data = updates.get('rbi_compliance', {})
            rbi_data['total_items'] = updates.get('total_items')
            rbi_data['jewellery_items'] = updates.get('jewellery_items')
            return self.save_rbi_compliance(session_id, rbi_data)
        return True

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM overall_sessions WHERE session_id = %s", (session_id,))
            overall = cursor.fetchone()
            if not overall:
                return None
            result = dict(overall)
            
            cursor.execute("SELECT customer_image FROM customer_details WHERE session_id = %s ORDER BY created_at DESC LIMIT 1", (session_id,))
            cust = cursor.fetchone()
            if cust:
                result['customer_front_image'] = cust['customer_image']
            
            cursor.execute("SELECT * FROM rbi_compliance_details WHERE session_id = %s ORDER BY created_at DESC LIMIT 1", (session_id,))
            rbi = cursor.fetchone()
            if rbi:
                # Always set total_items first (integer, no parsing needed)
                result['total_items'] = rbi['total_items'] or 0
                
                # Parse JSON fields separately with individual error handling
                try:
                    result['rbi_compliance'] = {
                        'overall_images': json.loads(rbi['overall_images']) if rbi['overall_images'] else [],
                        'total_items': rbi['total_items'] or 0
                    }
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"Warning: Failed to parse overall_images: {e}")
                    result['rbi_compliance'] = {'overall_images': [], 'total_items': rbi['total_items'] or 0}
                
                try:
                    result['jewellery_items'] = json.loads(rbi['item_images']) if rbi['item_images'] else []
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"Warning: Failed to parse item_images: {e}")
                    result['jewellery_items'] = []

            cursor.execute("SELECT results, total_items FROM purity_test_details WHERE session_id = %s ORDER BY created_at DESC LIMIT 1", (session_id,))
            pure = cursor.fetchone()
            if pure:
                try:
                    result['purity_results'] = json.loads(pure['results']) if pure['results'] else {}
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"Warning: Failed to parse purity_results: {e}")
                    result['purity_results'] = {}
            
            result['appraiser_data'] = {
                'name': overall['name'],
                'id': overall['appraiser_id'],
                'bank': overall['bank'],
                'branch': overall['branch'],
                'email': overall['email'],
                'phone': overall['phone'],
                'image': overall['image_data']
            }
            return result
        finally:
            cursor.close()
            self.return_connection(conn)

    def delete_session(self, session_id: str) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM overall_sessions WHERE session_id = %s", (session_id,))
            conn.commit()
            return True
        finally:
            cursor.close()
            self.return_connection(conn)

    # =========================================================================
    # Face Recognition & Appraiser Registration
    # =========================================================================
    
    def insert_appraiser(self, name, appraiser_id, image_data, timestamp, face_encoding=None, 
                         bank=None, branch=None, email=None, phone=None,
                         bank_id=None, branch_id=None, tenant_user_id=None):
        """
        Store 'Registered' Appraiser in overall_sessions with a special session_id prefix.
        This serves as the Master Appraiser List with tenant hierarchy support.
        """
        pseudo_session_id = f"registration_{appraiser_id}"
        
        # Try to resolve bank_id and branch_id if not provided
        if not bank_id and bank:
            bank_code = bank.replace(' ', '_').upper()[:20]
            bank_record = self.get_bank_by_code(bank_code)
            if not bank_record:
                # Auto-create bank if it doesn't exist
                bank_id = self.create_bank(
                    bank_code=bank_code,
                    bank_name=bank,
                    bank_short_name=bank[:20] if len(bank) > 20 else bank
                )
            else:
                bank_id = bank_record['id']
        
        if not branch_id and branch and bank_id:
            branch_code = branch.replace(' ', '_').upper()[:20]
            branch_record = self.get_branch_by_code(bank_id, branch_code)
            if not branch_record:
                # Auto-create branch if it doesn't exist
                branch_id = self.create_branch(
                    bank_id=bank_id,
                    branch_code=branch_code,
                    branch_name=branch
                )
            else:
                branch_id = branch_record['id']
        
        # Create or update tenant user if tenant_user_id not provided
        if not tenant_user_id and bank_id:
            existing_user = self.get_tenant_user_by_id(bank_id, appraiser_id)
            if existing_user:
                tenant_user_id = existing_user['id']
            else:
                tenant_user_id = self.create_tenant_user(
                    user_id=appraiser_id,
                    bank_id=bank_id,
                    branch_id=branch_id,
                    full_name=name,
                    email=email,
                    phone=phone,
                    face_encoding=face_encoding,
                    image_data=image_data
                )
        
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Upsert logic for overall_sessions registration
            cursor.execute("SELECT id FROM overall_sessions WHERE session_id = %s", (pseudo_session_id,))
            existing = cursor.fetchone()
            
            if existing:
                cursor.execute('''
                    UPDATE overall_sessions 
                    SET name = %s, image_data = %s, face_encoding = %s, status = 'registered', created_at = %s,
                        bank = %s, branch = %s, email = %s, phone = %s,
                        bank_id = %s, branch_id = %s, tenant_user_id = %s
                    WHERE session_id = %s
                    RETURNING id
                ''', (name, image_data, face_encoding, timestamp, 
                      bank, branch, email, phone,
                      bank_id, branch_id, tenant_user_id,
                      pseudo_session_id))
            else:
                cursor.execute('''
                    INSERT INTO overall_sessions (
                        session_id, name, appraiser_id, image_data, face_encoding, status, created_at,
                        bank, branch, email, phone, bank_id, branch_id, tenant_user_id
                    ) VALUES (%s, %s, %s, %s, %s, 'registered', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                ''', (pseudo_session_id, name, appraiser_id, image_data, face_encoding, timestamp,
                      bank, branch, email, phone, bank_id, branch_id, tenant_user_id))
            
            result = cursor.fetchone()
            
            # Create appraiser bank/branch mapping entry
            if bank_id and branch_id:
                cursor.execute('''
                    INSERT INTO appraiser_bank_branch_map (appraiser_id, bank_id, branch_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (appraiser_id, bank_id, branch_id) DO UPDATE
                    SET is_active = true, updated_at = CURRENT_TIMESTAMP
                ''', (appraiser_id, bank_id, branch_id))
            
            conn.commit()
            return result['id']
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)

    def get_all_appraisers_with_face_encoding(self) -> List[Dict[str, Any]]:
        """Fetch registered appraisers for facial recognition with tenant context"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Only fetch 'registered' status rows to avoid confusion with actual sessions
            cursor.execute('''
                SELECT m.id, m.name, m.appraiser_id, m.image_data, m.face_encoding, m.created_at,
                       m.bank, m.branch, m.email, m.phone,
                       m.bank_id, m.branch_id, m.tenant_user_id,
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code,
                       tu.full_name as tenant_user_name, tu.user_id as tenant_user_id_text,
                       tu.employee_id, tu.designation, tu.user_role,
                       (SELECT COUNT(*) FROM overall_sessions s 
                        WHERE s.appraiser_id = m.appraiser_id AND s.status != 'registered') as appraisals_completed
                FROM overall_sessions m
                LEFT JOIN banks b ON m.bank_id = b.id
                LEFT JOIN branches br ON m.branch_id = br.id
                LEFT JOIN tenant_users tu ON m.tenant_user_id = tu.id
                WHERE m.face_encoding IS NOT NULL AND m.status = 'registered'
            ''')
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)

    def get_appraisers_by_filters(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetch registered appraisers with face encoding based on specific filters (bank, branch, name, etc.)"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Build WHERE clause based on filters
            # Query overall_sessions with status='registered' (where appraiser registration data is stored)
            where_conditions = ["os.face_encoding IS NOT NULL", "os.status = 'registered'"]
            params = []
            
            if 'appraiser_id' in filters:
                where_conditions.append("os.appraiser_id = %s")
                params.append(filters['appraiser_id'])
            
            if 'name' in filters:
                where_conditions.append("LOWER(os.name) = LOWER(%s)")
                params.append(filters['name'])
                
            if 'bank_id' in filters:
                where_conditions.append("os.bank_id = %s")
                params.append(filters['bank_id'])
                
            if 'branch_id' in filters:
                where_conditions.append("os.branch_id = %s")
                params.append(filters['branch_id'])
            
            where_clause = " AND ".join(where_conditions)
            
            query = f'''
                SELECT os.id, os.name, os.appraiser_id, os.image_data, os.face_encoding, 
                       os.created_at, os.bank, os.branch, os.email, os.phone,
                       os.bank_id, os.branch_id, os.tenant_user_id,
                       b.bank_name, b.bank_code,
                       br.branch_name, br.branch_code,
                       tu.full_name as tenant_user_name, tu.user_id as tenant_user_id_text,
                       tu.employee_id, tu.designation, tu.user_role
                FROM overall_sessions os
                LEFT JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                LEFT JOIN tenant_users tu ON os.tenant_user_id = tu.id
                WHERE {where_clause}
                ORDER BY os.created_at DESC
            '''
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
            
    def get_appraiser_by_id(self, appraiser_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            pseudo_session_id = f"registration_{appraiser_id}"
            cursor.execute("SELECT * FROM overall_sessions WHERE session_id = %s", (pseudo_session_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    # =========================================================================
    # Appraiser Bank/Branch Mapping Methods
    # =========================================================================
    
    def add_appraiser_to_bank_branch(self, appraiser_id: str, bank_id: int, branch_id: int) -> bool:
        """Add an appraiser mapping to a bank/branch"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO appraiser_bank_branch_map (appraiser_id, bank_id, branch_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (appraiser_id, bank_id, branch_id) DO UPDATE
                SET is_active = true, updated_at = CURRENT_TIMESTAMP
            ''', (appraiser_id, bank_id, branch_id))
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def remove_appraiser_from_bank_branch(self, appraiser_id: str, bank_id: int, branch_id: int) -> bool:
        """Remove an appraiser mapping from a bank/branch (soft delete)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                UPDATE appraiser_bank_branch_map 
                SET is_active = false, updated_at = CURRENT_TIMESTAMP
                WHERE appraiser_id = %s AND bank_id = %s AND branch_id = %s
            ''', (appraiser_id, bank_id, branch_id))
            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_appraiser_bank_branch_mappings(self, appraiser_id: str) -> List[Dict[str, Any]]:
        """Get all bank/branch mappings for an appraiser"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT m.id, m.appraiser_id, m.bank_id, m.branch_id, m.is_active, m.created_at,
                       b.bank_name, b.bank_code, br.branch_name, br.branch_code
                FROM appraiser_bank_branch_map m
                JOIN banks b ON m.bank_id = b.id
                JOIN branches br ON m.branch_id = br.id
                WHERE m.appraiser_id = %s AND m.is_active = true
            ''', (appraiser_id,))
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def is_appraiser_mapped_to_bank_branch(self, appraiser_id: str, bank_id: int, branch_id: int) -> bool:
        """Check if an appraiser is mapped to a specific bank/branch"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT 1 FROM appraiser_bank_branch_map
                WHERE appraiser_id = %s AND bank_id = %s AND branch_id = %s AND is_active = true
            ''', (appraiser_id, bank_id, branch_id))
            return cursor.fetchone() is not None
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_appraisers_for_bank_branch(self, bank_id: int, branch_id: int) -> List[Dict[str, Any]]:
        """Get all appraisers mapped to a specific bank/branch with their face encodings"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT os.id, os.name, os.appraiser_id, os.image_data, os.face_encoding, os.created_at,
                       os.email, os.phone, b.bank_name, br.branch_name
                FROM appraiser_bank_branch_map m
                JOIN overall_sessions os ON m.appraiser_id = os.appraiser_id AND os.status = 'registered'
                JOIN banks b ON m.bank_id = b.id
                JOIN branches br ON m.branch_id = br.id
                WHERE m.bank_id = %s AND m.branch_id = %s AND m.is_active = true
            ''', (bank_id, branch_id))
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def verify_appraiser_exists_in_bank_branch(self, name: str, bank_id: int, branch_id: int) -> Optional[Dict[str, Any]]:
        """
        Verify if an appraiser with given name exists and is mapped to the bank/branch.
        
        IMPORTANT: This method handles cases where multiple appraisers may have the same name
        across different banks/branches. It checks ALL appraisers with the given name and
        returns the one that is mapped to the requested bank/branch.
        
        First checks the mapping table, then falls back to direct registration check.
        """
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Find ALL appraisers with this name (there may be multiple across different banks)
            cursor.execute('''
                SELECT os.id, os.appraiser_id, os.name, os.email, os.phone, 
                       os.bank_id, os.branch_id, os.created_at, os.face_encoding, os.image_data
                FROM overall_sessions os
                WHERE os.status = 'registered' AND LOWER(os.name) = LOWER(%s)
            ''', (name.strip(),))
            
            appraisers = cursor.fetchall()
            
            if not appraisers:
                return None
            
            # Check each appraiser to find one mapped to the requested bank/branch
            for appraiser in appraisers:
                # Check if this appraiser is mapped to the requested bank/branch via mapping table
                cursor.execute('''
                    SELECT 1 FROM appraiser_bank_branch_map
                    WHERE appraiser_id = %s AND bank_id = %s AND branch_id = %s AND is_active = true
                ''', (appraiser['appraiser_id'], bank_id, branch_id))
                
                is_mapped = cursor.fetchone() is not None
                
                # If not in mapping table, check if directly registered to this bank/branch
                if not is_mapped:
                    if appraiser['bank_id'] == bank_id and appraiser['branch_id'] == branch_id:
                        is_mapped = True
                        # Auto-create mapping for existing registrations
                        cursor.execute('''
                            INSERT INTO appraiser_bank_branch_map (appraiser_id, bank_id, branch_id)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (appraiser_id, bank_id, branch_id) DO NOTHING
                        ''', (appraiser['appraiser_id'], bank_id, branch_id))
                        conn.commit()
                
                if is_mapped:
                    # Get bank and branch names
                    cursor.execute('SELECT bank_name FROM banks WHERE id = %s', (bank_id,))
                    bank_row = cursor.fetchone()
                    cursor.execute('SELECT branch_name FROM branches WHERE id = %s', (branch_id,))
                    branch_row = cursor.fetchone()
                    
                    return {
                        'id': appraiser['id'],
                        'appraiser_id': appraiser['appraiser_id'],
                        'name': appraiser['name'],
                        'email': appraiser['email'],
                        'phone': appraiser['phone'],
                        'bank_id': bank_id,
                        'branch_id': branch_id,
                        'bank_name': bank_row['bank_name'] if bank_row else None,
                        'branch_name': branch_row['branch_name'] if branch_row else None,
                        'has_face_encoding': bool(appraiser['face_encoding']),
                        'has_image': bool(appraiser['image_data']),
                        'timestamp': str(appraiser['created_at']) if appraiser['created_at'] else None
                    }
            
            # No appraiser with this name is mapped to the requested bank/branch
            return None
        finally:
            cursor.close()
            self.return_connection(conn)

    def get_statistics(self) -> Dict[str, Any]:
        """Get stats from overall_sessions"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT COUNT(*) as total FROM overall_sessions WHERE status != 'registered'")
            total_appraisals = cursor.fetchone()['total']
            
            # Get total items from rbi_compliance_details
            cursor.execute("SELECT SUM(total_items) as total FROM rbi_compliance_details")
            items = cursor.fetchone()
            total_items = items['total'] if items['total'] else 0
            
            # Get bank-wise statistics
            cursor.execute('''
                SELECT b.bank_name, b.bank_code, COUNT(os.id) as appraisal_count
                FROM banks b
                LEFT JOIN overall_sessions os ON b.id = os.bank_id AND os.status != 'registered'
                GROUP BY b.id, b.bank_name, b.bank_code
                ORDER BY appraisal_count DESC
            ''')
            bank_stats = cursor.fetchall()
            
            # Get total appraisers count
            cursor.execute("SELECT COUNT(*) as total FROM tenant_users WHERE is_active = true")
            total_appraisers = cursor.fetchone()['total']
            
            return {
                "total_appraisals": total_appraisals,
                "total_items": total_items,
                "total_appraisers": total_appraisers,
                "bank_statistics": [dict(row) for row in bank_stats],
                "recent_appraisals": []
            }
        finally:
            cursor.close()
            self.return_connection(conn)

    # =========================================================================
    # Tenant-Specific Query Methods
    # =========================================================================
    
    def get_sessions_by_bank(self, bank_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all sessions for a specific bank"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT os.*, b.bank_name, br.branch_name
                FROM overall_sessions os
                JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                WHERE os.bank_id = %s AND os.status != 'registered'
                ORDER BY os.created_at DESC
                LIMIT %s
            ''', (bank_id, limit))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_sessions_by_branch(self, branch_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all sessions for a specific branch"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT os.*, b.bank_name, br.branch_name
                FROM overall_sessions os
                JOIN banks b ON os.bank_id = b.id
                JOIN branches br ON os.branch_id = br.id
                WHERE os.branch_id = %s AND os.status != 'registered'
                ORDER BY os.created_at DESC
                LIMIT %s
            ''', (branch_id, limit))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_sessions_by_tenant_user(self, tenant_user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all sessions for a specific tenant user (appraiser)"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute('''
                SELECT os.*, b.bank_name, br.branch_name, tu.full_name as appraiser_name
                FROM overall_sessions os
                JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                LEFT JOIN tenant_users tu ON os.tenant_user_id = tu.id
                WHERE os.tenant_user_id = %s AND os.status != 'registered'
                ORDER BY os.created_at DESC
                LIMIT %s
            ''', (tenant_user_id, limit))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            self.return_connection(conn)
    
    def get_bank_dashboard_stats(self, bank_id: int) -> Dict[str, Any]:
        """Get dashboard statistics for a specific bank"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # Get basic counts
            cursor.execute('''
                SELECT 
                    COUNT(CASE WHEN status != 'registered' THEN 1 END) as total_appraisals,
                    COUNT(CASE WHEN status = 'purity_completed' THEN 1 END) as completed_appraisals,
                    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_appraisals
                FROM overall_sessions 
                WHERE bank_id = %s
            ''', (bank_id,))
            basic_stats = cursor.fetchone()
            
            # Get branch-wise breakdown
            cursor.execute('''
                SELECT br.branch_name, COUNT(os.id) as appraisal_count
                FROM branches br
                LEFT JOIN overall_sessions os ON br.id = os.branch_id AND os.status != 'registered'
                WHERE br.bank_id = %s
                GROUP BY br.id, br.branch_name
                ORDER BY appraisal_count DESC
            ''', (bank_id,))
            branch_stats = cursor.fetchall()
            
            # Get total items appraised
            cursor.execute('''
                SELECT SUM(rbi.total_items) as total_items
                FROM rbi_compliance_details rbi
                WHERE rbi.bank_id = %s
            ''', (bank_id,))
            items_result = cursor.fetchone()
            total_items = items_result['total_items'] if items_result['total_items'] else 0
            
            return {
                'total_appraisals': basic_stats['total_appraisals'],
                'completed_appraisals': basic_stats['completed_appraisals'],
                'in_progress_appraisals': basic_stats['in_progress_appraisals'],
                'total_items': total_items,
                'branch_breakdown': [dict(row) for row in branch_stats]
            }
        finally:
            cursor.close()
            self.return_connection(conn)


# Singleton Database instance for FastAPI - initialized once at startup
_db_instance: Optional[Database] = None

def get_database() -> Database:
    """Get or create the singleton Database instance"""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database(skip_init=False)  # Initialize DB on first use
    return _db_instance


# FastAPI dependency function for database connection
def get_db():
    """FastAPI dependency for database connection - uses connection pooling"""
    db = get_database()  # Use singleton instance (no re-initialization)
    connection = db.get_connection()
    try:
        yield connection
    finally:
        db.return_connection(connection)  # Return to pool instead of closing
