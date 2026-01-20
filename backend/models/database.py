import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Optional, List, Dict, Any
import json
import os
from dotenv import load_dotenv

load_dotenv()

class Database:
    def __init__(self):
        """Initialize Database connection (Supabase/PostgreSQL)"""
        # Load environment variables explicitly
        load_dotenv(override=True)
        
        # Priority: Individual variables (easier to manage) -> DATABASE_URL
        host = os.getenv('DB_HOST', '').strip()
        database_url = os.getenv('DATABASE_URL', '').strip()
        
        if host:
            # Using individual parameters
            self.connection_string = None
            self.connection_params = {
                'host': host,
                'port': os.getenv('DB_PORT', '5432').strip(),
                'database': os.getenv('DB_NAME', 'postgres').strip(),
                'user': os.getenv('DB_USER', 'postgres').strip(),
                'password': os.getenv('DB_PASSWORD', '').strip(),
            }
            # Add SSL requirement for Supabase
            if "supabase" in host.lower():
                self.connection_params['sslmode'] = 'require'
        elif database_url:
            # Falling back to connection string
            self.connection_string = database_url.replace('postgresql+psycopg2://', 'postgresql://')
            if "supabase" in self.connection_string.lower() and "sslmode" not in self.connection_string:
                sep = "&" if "?" in self.connection_string else "?"
                self.connection_string += f"{sep}sslmode=require"
            self.connection_params = None
        else:
            # Default to local
            self.connection_string = "postgresql://postgres:admin@localhost:5432/gold_loan_appraisal"
            self.connection_params = None

        self.init_database()
    
    def _parse_database_url(self, url):
        """Parse DATABASE_URL into connection parameters"""
        import re
        # Format: postgresql://user:password@host:port/database
        # Use non-greedy match for password to handle @ in password
        pattern = r'postgresql(?:\+psycopg2)?://([^:]+):(.+?)@([^:]+):(\d+)/(.+)'
        match = re.match(pattern, url)
        if match:
            user, password, host, port, database = match.groups()
            self.connection_params = {
                'host': host,
                'port': port,
                'database': database,
                'user': user,
                'password': password,
            }
        else:
            raise ValueError(f"Invalid DATABASE_URL format: {url}")
    
    def get_connection(self):
        """Get database connection with SSL support and helpful error handling"""
        try:
            if self.connection_params:
                # psycopg2 handles special characters in password automatically when passed via dict
                return psycopg2.connect(**self.connection_params)
            elif self.connection_string:
                return psycopg2.connect(self.connection_string)
            else:
                raise ValueError("No connection parameters or string available")
        except psycopg2.OperationalError as e:
            raise e
        except Exception as e:
            raise e
    
    def init_database(self):
        """Initialize database tables"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Appraisers table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS appraisers (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    appraiser_id TEXT UNIQUE NOT NULL,
                    image_data TEXT,
                    face_encoding TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Add face_encoding column if it doesn't exist (for existing databases)
            try:
                cursor.execute('''
                    ALTER TABLE appraisers 
                    ADD COLUMN IF NOT EXISTS face_encoding TEXT
                ''')
            except Exception:
                pass
            
            # Appraisals table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS appraisals (
                    id SERIAL PRIMARY KEY,
                    appraiser_id INTEGER NOT NULL,
                    appraiser_name TEXT NOT NULL,
                    total_items INTEGER DEFAULT 0,
                    purity TEXT,
                    testing_method TEXT,
                    status TEXT DEFAULT 'completed',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (appraiser_id) REFERENCES appraisers (id)
                )
            ''')
            

            
            # Appraisal sessions table (for workflow data storage)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS appraisal_sessions (
                    id SERIAL PRIMARY KEY,
                    session_id TEXT UNIQUE NOT NULL,
                    appraiser_data TEXT,
                    customer_front_image TEXT,
                    customer_side_image TEXT,
                    rbi_compliance TEXT,
                    jewellery_items TEXT,
                    purity_results TEXT,
                    gps_data TEXT,
                    total_items INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'in_progress',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()
    
    def test_connection(self) -> bool:
        """Test database connection"""
        try:
            conn = self.get_connection()
            conn.close()
            return True
        except Exception:
            return False
    
    # Appraiser operations
    def insert_appraiser(self, name: str, appraiser_id: str, image_data: str, timestamp: str, face_encoding: str = None) -> int:
        """Insert or update appraiser details"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            # Check if appraiser already exists
            cursor.execute("SELECT id FROM appraisers WHERE appraiser_id = %s", (appraiser_id,))
            existing = cursor.fetchone()
            
            if existing:
                # Update existing appraiser
                cursor.execute('''
                    UPDATE appraisers 
                    SET name = %s, image_data = %s, face_encoding = %s
                    WHERE appraiser_id = %s
                    RETURNING id
                ''', (name, image_data, face_encoding, appraiser_id))
                result = cursor.fetchone()
                appraiser_db_id = result['id']
            else:
                # Insert new appraiser
                cursor.execute('''
                    INSERT INTO appraisers (name, appraiser_id, image_data, face_encoding)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                ''', (name, appraiser_id, image_data, face_encoding))
                result = cursor.fetchone()
                appraiser_db_id = result['id']
            
            conn.commit()
            return appraiser_db_id
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def get_appraiser_by_id(self, appraiser_id: str) -> Optional[Dict[str, Any]]:
        """Get appraiser by appraiser_id"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute("SELECT * FROM appraisers WHERE appraiser_id = %s", (appraiser_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            conn.close()
    
    def get_all_appraisers_with_face_encoding(self) -> List[Dict[str, Any]]:
        """Get all appraisers that have face encodings for recognition"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute("SELECT * FROM appraisers WHERE face_encoding IS NOT NULL")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            conn.close()
    
    # Appraisal operations
    def create_appraisal(self, appraiser_id: int, appraiser_name: str, 
                        total_items: int, purity: str, testing_method: str) -> int:
        """Create a new appraisal record"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute('''
                INSERT INTO appraisals (appraiser_id, appraiser_name, total_items, purity, testing_method)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', (appraiser_id, appraiser_name, total_items, purity, testing_method))
            
            result = cursor.fetchone()
            appraisal_id = result['id']
            conn.commit()
            return appraisal_id
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def get_appraisal_by_id(self, appraisal_id: int) -> Optional[Dict[str, Any]]:
        """Get complete appraisal details with all related data"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            # Get appraisal
            cursor.execute("SELECT * FROM appraisals WHERE id = %s", (appraisal_id,))
            appraisal_row = cursor.fetchone()
            
            if not appraisal_row:
                return None
            
            appraisal = dict(appraisal_row)
            
            # Get appraiser details
            cursor.execute("SELECT * FROM appraisers WHERE id = %s", (appraisal['appraiser_id'],))
            appraiser_row = cursor.fetchone()
            if appraiser_row:
                appraisal['appraiser'] = dict(appraiser_row)
            
            # Get jewellery items
            cursor.execute("SELECT * FROM jewellery_items WHERE appraisal_id = %s", (appraisal_id,))
            items_rows = cursor.fetchall()
            appraisal['jewellery_items'] = [dict(row) for row in items_rows]
            
            # Get RBI compliance
            cursor.execute("SELECT * FROM rbi_compliance WHERE appraisal_id = %s", (appraisal_id,))
            rbi_row = cursor.fetchone()
            if rbi_row:
                appraisal['rbi_compliance'] = dict(rbi_row)
            
            # Get purity test
            cursor.execute("SELECT * FROM purity_tests WHERE appraisal_id = %s", (appraisal_id,))
            purity_row = cursor.fetchone()
            if purity_row:
                appraisal['purity_test'] = dict(purity_row)
            
            return appraisal
        finally:
            cursor.close()
            conn.close()
    
    def get_all_appraisals(self, skip: int = 0, limit: int = 100) -> List[Dict[str, Any]]:
        """Get all appraisal records with pagination"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute('''
                SELECT id, appraiser_name, appraiser_id, total_items, purity, 
                       testing_method, status, created_at
                FROM appraisals
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            ''', (limit, skip))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            cursor.close()
            conn.close()
    
    def delete_appraisal(self, appraisal_id: int) -> bool:
        """Delete an appraisal and all related records"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("DELETE FROM appraisals WHERE id = %s", (appraisal_id,))
            affected = cursor.rowcount
            conn.commit()
            return affected > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    

    # Statistics
    def get_statistics(self) -> Dict[str, Any]:
        """Get appraisal statistics"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            # Total appraisals
            cursor.execute("SELECT COUNT(*) as total FROM appraisals")
            total_appraisals = cursor.fetchone()['total']
            
            # Total items
            cursor.execute("SELECT SUM(total_items) as total FROM appraisals")
            result = cursor.fetchone()
            total_items = result['total'] if result['total'] else 0
            
            # Total appraisers
            cursor.execute("SELECT COUNT(*) as total FROM appraisers")
            total_appraisers = cursor.fetchone()['total']
            
            # Recent appraisals (last 10)
            cursor.execute('''
                SELECT id, appraiser_name, total_items, purity, created_at
                FROM appraisals
                ORDER BY created_at DESC
                LIMIT 10
            ''')
            recent = cursor.fetchall()
            
            return {
                "total_appraisals": total_appraisals,
                "total_items": total_items,
                "total_appraisers": total_appraisers,
                "recent_appraisals": [dict(row) for row in recent]
            }
        finally:
            cursor.close()
            conn.close()
    
    # =========================================================================
    # Session Management (for workflow data storage)
    # =========================================================================
    
    def create_session(self) -> str:
        """Create a new appraisal session and return session_id"""
        import uuid
        session_id = str(uuid.uuid4())
        
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO appraisal_sessions (session_id)
                VALUES (%s)
                RETURNING session_id
            ''', (session_id,))
            
            result = cursor.fetchone()
            conn.commit()
            return result[0]
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get all session data"""
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute('''
                SELECT * FROM appraisal_sessions WHERE session_id = %s
            ''', (session_id,))
            
            row = cursor.fetchone()
            if row:
                result = dict(row)
                # Parse JSON fields
                for field in ['appraiser_data', 'rbi_compliance', 'jewellery_items', 'purity_results', 'gps_data']:
                    if result.get(field):
                        try:
                            result[field] = json.loads(result[field])
                        except:
                            pass
                return result
            return None
        finally:
            cursor.close()
            conn.close()
    
    def update_session_field(self, session_id: str, field: str, data: Any) -> bool:
        """Update a specific field in the session"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Validate field name to prevent SQL injection
        valid_fields = ['appraiser_data', 'customer_front_image', 'customer_side_image', 
                       'rbi_compliance', 'jewellery_items', 'purity_results', 'gps_data', 
                       'total_items', 'status']
        if field not in valid_fields:
            raise ValueError(f"Invalid field: {field}")
        
        try:
            # Convert dict/list to JSON string
            if isinstance(data, (dict, list)):
                data = json.dumps(data)
            
            cursor.execute(f'''
                UPDATE appraisal_sessions 
                SET {field} = %s, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = %s
            ''', (data, session_id))
            
            affected = cursor.rowcount
            conn.commit()
            return affected > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def update_session_multiple(self, session_id: str, updates: Dict[str, Any]) -> bool:
        """Update multiple fields in the session at once"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        valid_fields = ['appraiser_data', 'customer_front_image', 'customer_side_image', 
                       'rbi_compliance', 'jewellery_items', 'purity_results', 'gps_data', 
                       'total_items', 'status']
        
        try:
            set_clauses = []
            values = []
            
            for field, data in updates.items():
                if field not in valid_fields:
                    raise ValueError(f"Invalid field: {field}")
                
                # Convert dict/list to JSON string
                if isinstance(data, (dict, list)):
                    data = json.dumps(data)
                
                set_clauses.append(f"{field} = %s")
                values.append(data)
            
            if not set_clauses:
                return False
            
            set_clauses.append("updated_at = CURRENT_TIMESTAMP")
            values.append(session_id)
            
            query = f'''
                UPDATE appraisal_sessions 
                SET {", ".join(set_clauses)}
                WHERE session_id = %s
            '''
            
            cursor.execute(query, values)
            affected = cursor.rowcount
            conn.commit()
            return affected > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                DELETE FROM appraisal_sessions WHERE session_id = %s
            ''', (session_id,))
            
            affected = cursor.rowcount
            conn.commit()
            return affected > 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()
            conn.close()
    
    def close(self):
        """Close database connection (placeholder for cleanup)"""
        # PostgreSQL connections are managed per-request
        # This method exists for compatibility with the main.py shutdown event
        pass
