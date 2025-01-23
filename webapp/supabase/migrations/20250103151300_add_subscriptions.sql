/*
  # Add subscription management
  
  1. New Tables
    - `subscriptions`
      - Links to user_profiles via user_email
      - Stores Stripe subscription data
      - Tracks payment status
  
  2. Security
    - Enable RLS
    - Only service role can write (handled by cloud functions)
    - Users can read their own subscription data
*/

-- Create subscriptions table
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_email text not null references user_profiles(phone_number),
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  status text not null,
  current_period_end timestamp with time zone not null,
  last_payment_status text,
  last_payment_date timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.subscriptions enable row level security;

-- Create policy for users to view their own subscription
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.jwt() ->> 'email' = user_email);

-- Add function to handle updated_at
create or replace function public.handle_subscription_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Add trigger to automatically update updated_at
create trigger handle_subscription_updated_at
  before update on public.subscriptions
  for each row
  execute procedure public.handle_subscription_updated_at();

-- Create indexes for better query performance
create index if not exists idx_subscriptions_user_email 
  on public.subscriptions(user_email);
create index if not exists idx_subscriptions_stripe_customer_id 
  on public.subscriptions(stripe_customer_id);
create index if not exists idx_subscriptions_status 
  on public.subscriptions(status); 