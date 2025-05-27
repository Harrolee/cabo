# Temporary Authentication Bypass for Coach Builder

## Overview

This implementation provides a temporary bypass for OTP authentication specifically for the coach-builder flow. Users can now sign in using either their phone number or email address without requiring OTP verification.

## How It Works

### 1. Modified Login Page (`webapp/src/App.jsx`)

The `LoginPage` component now includes:
- **Temporary bypass mode**: Enabled by default with `tempBypassOtp = true`
- **Dual input support**: Accepts both email addresses and phone numbers
- **Direct authentication**: Looks up users in the database and creates temporary sessions
- **Fallback to OTP**: Users can still opt to use OTP verification if needed

### 2. Session Management

The app now handles two types of sessions:
- **Regular Supabase sessions**: Standard authentication flow
- **Temporary sessions**: Stored in `sessionStorage` with mock session data

### 3. Coach Builder Integration

- **CoachSavePrompt**: Updated to handle temporary authentication
- **CoachBuilderContext**: Modified `saveCoach` function to work with temp auth
- **AuthenticatedLayout**: Shows visual indicator for temporary sessions

## Key Features

### Visual Indicators
- Yellow warning banner on login page indicating temporary mode
- "🚧 Temp Session" indicator in navigation for temporary sessions
- Clear messaging about the bypass being temporary

### User Experience
- Enter email or phone number → immediate sign-in
- No waiting for OTP codes
- Seamless coach building and saving experience
- Option to switch back to OTP if desired

### Security Considerations
- Temporary sessions are stored in `sessionStorage` (cleared on tab close)
- Only works for existing users (looks up in `user_profiles` table)
- No new account creation through this bypass
- Sessions are clearly marked as temporary

## Implementation Details

### Login Flow
1. User enters email or phone number
2. System looks up user in `user_profiles` table
3. If found, creates temporary session data
4. Stores session in `sessionStorage`
5. Triggers custom event to update app state
6. Redirects to intended destination

### Session Structure
```javascript
{
  user: {
    email: "user@example.com",
    phone: "+1234567890",
    user_metadata: { name: "User Name" }
  },
  access_token: "temp-token",
  refresh_token: "temp-refresh"
}
```

### Database Compatibility
- Uses existing `user_profiles` table structure
- No database schema changes required
- Works with both email and phone number lookups
- Maintains compatibility with existing RLS policies

## Usage

### For Users
1. Go to `/login`
2. Enter your email address or phone number
3. Click "Sign In"
4. You'll be immediately logged in and redirected

### For Developers
- Set `tempBypassOtp = false` in `LoginPage` to disable bypass
- Remove temporary session handling to revert to OTP-only
- Monitor `sessionStorage` for debugging temporary sessions

## Cleanup Instructions

When OTP is working again, remove:
1. `tempBypassOtp` state and related logic in `LoginPage`
2. Temporary session handling in main App `useEffect`
3. Temporary auth checks in `CoachSavePrompt` and `CoachBuilderContext`
4. Session storage cleanup in `AuthenticatedLayout`

## Files Modified

- `webapp/src/App.jsx` - Login page and session management
- `webapp/src/components/CoachBuilder/CoachSavePrompt.jsx` - Temp auth support
- `webapp/src/contexts/CoachBuilderContext.jsx` - Save function updates

## Testing

The implementation has been tested with:
- ✅ Build process (no syntax errors)
- ✅ Email-based login
- ✅ Phone-based login
- ✅ Session persistence across page navigation
- ✅ Coach saving functionality

## Notes

- This is a **temporary solution** for development/testing purposes
- Should be removed once OTP functionality is restored
- Does not create new user accounts - only authenticates existing users
- Sessions are cleared when browser tab is closed 