export interface UserProfile {
  id: string;
  full_name: string;
  phone_number: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserProfile {
  full_name: string;
  phone_number: string;
}