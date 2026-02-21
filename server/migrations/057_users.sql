  -- Migration: Users Table                                
  -- User accounts for platform authentication             
                                                           
  CREATE TABLE IF NOT EXISTS users (                       
    id              UUID PRIMARY KEY DEFAULT               
  gen_random_uuid(),                                       
    email           TEXT NOT NULL UNIQUE,                  
    name            TEXT NOT NULL,                         
    password_hash   TEXT,                                  
    account_type    TEXT NOT NULL DEFAULT 'standard',      
    platform_role   TEXT,                                  
    avatar_url      TEXT,                                  
    last_login_at   TIMESTAMPTZ,                           
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),    
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()     
  );                                                       
                                                           
  -- Add platform_role column if it doesn't exist (for     
  existing users tables)                                   
  DO $$                                                    
  BEGIN                                                    
    IF NOT EXISTS (                                        
      SELECT 1 FROM information_schema.columns             
      WHERE table_name = 'users' AND column_name =         
  'platform_role'                                          
    ) THEN                                                 
      ALTER TABLE users ADD COLUMN platform_role TEXT;     
    END IF;                                                
  END $$;                                                  
                                                           
  -- Add avatar_url column if it doesn't exist             
  DO $$                                                    
  BEGIN                                                    
    IF NOT EXISTS (                                        
      SELECT 1 FROM information_schema.columns             
      WHERE table_name = 'users' AND column_name =         
  'avatar_url'                                             
    ) THEN                                                 
      ALTER TABLE users ADD COLUMN avatar_url TEXT;        
    END IF;                                                
  END $$;                                                  
                                                           
  CREATE INDEX IF NOT EXISTS idx_users_email               
    ON users(email);                                       
                                                           
  CREATE INDEX IF NOT EXISTS idx_users_account_type        
    ON users(account_type);                                
                                                           
  COMMENT ON TABLE users IS 'Platform user accounts';      
  COMMENT ON COLUMN users.password_hash IS 'bcrypt hash of 
  user password (nullable for OAuth-only users)';          
  COMMENT ON COLUMN users.account_type IS 'Account type:   
  standard, enterprise, trial';                            
  COMMENT ON COLUMN users.platform_role IS 'Platform-level 
  role (optional, used for admin features)';               
  EOF
