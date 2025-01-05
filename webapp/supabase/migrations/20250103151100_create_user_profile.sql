-- Create user_profile table
create table if not exists public.user_profile (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid references auth.users(id) on delete cascade,
    name text,
    phone_number text not null,
    active boolean default true,
    timezone text default 'UTC',
    constraint phone_number_format check (phone_number ~ '^\+[1-9]\d{1,14}$')
);

-- Create index on user_id
create index if not exists user_profile_user_id_idx on public.user_profile(user_id);

-- Set up Row Level Security (RLS)
alter table public.user_profile enable row level security;

-- Create policies
create policy "Users can view their own profile"
    on public.user_profile for select
    using (auth.uid() = user_id);

create policy "Users can update their own profile"
    on public.user_profile for update
    using (auth.uid() = user_id);

-- Function to handle updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- Trigger for updated_at
create trigger handle_updated_at
    before update on public.user_profile
    for each row
    execute procedure public.handle_updated_at();

-- Grant access to authenticated users
grant select, update on public.user_profile to authenticated; 