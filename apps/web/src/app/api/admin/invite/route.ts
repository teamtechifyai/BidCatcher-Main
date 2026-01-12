import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, role, clientId, generateLinkOnly } = body;

    console.log('[Invite API] Request:', { email, name, role, clientId, hasServiceKey: !!supabaseServiceKey });

    if (!email) {
      return NextResponse.json(
        { success: false, error: { message: 'Email is required' } },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid email format' } },
        { status: 400 }
      );
    }

    // If we have the service role key, use Supabase Admin API
    if (supabaseServiceKey) {
      console.log('[Invite API] Using service role key');
      return await inviteWithServiceRole(email, name, role, clientId, generateLinkOnly);
    }

    // Fallback: create user directly
    console.log('[Invite API] No service role key, using direct creation');
    return await createUserDirectly(email, name, role, clientId);

  } catch (error) {
    console.error('Invite API error:', error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : 'Failed to send invitation' } },
      { status: 500 }
    );
  }
}

async function inviteWithServiceRole(
  email: string, 
  name: string | null, 
  role: string, 
  clientId: string | null,
  generateLinkOnly: boolean = false
) {
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Get app URL from env var - REQUIRED for production
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error('[Invite API] NEXT_PUBLIC_APP_URL not set!');
    throw new Error('Server misconfigured: NEXT_PUBLIC_APP_URL environment variable is required');
  }
  console.log('[Invite API] Using app URL:', appUrl);

  if (generateLinkOnly) {
    // Generate a magic link that can be shared manually
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        data: {
          name: name || null,
          invited_role: role || 'user',
          invited_client_id: clientId || null,
        },
        redirectTo: `${appUrl}/auth/callback`,
      },
    });

    if (linkError) {
      console.error('Generate link error:', linkError);
      return NextResponse.json(
        { success: false, error: { message: linkError.message } },
        { status: 400 }
      );
    }

    // Create user profile
    if (linkData.user) {
      const profileResult = await createUserProfile(supabaseAdmin, linkData.user.id, email, name, role, clientId);
      if (!profileResult.success) {
        return NextResponse.json({
          success: false,
          error: { message: profileResult.error || 'Failed to create user profile' },
        }, { status: 400 });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Invite link generated',
        inviteLink: linkData.properties?.action_link,
        userId: linkData.user?.id,
      },
    });
  }

  // Send invitation email
  console.log('[Invite API] Sending invite to:', email, 'redirectTo:', `${appUrl}/auth/accept-invite`);
  
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      name: name || null,
      invited_role: role || 'user',
      invited_client_id: clientId || null,
    },
    redirectTo: `${appUrl}/auth/accept-invite`,
  });

  if (authError) {
    console.error('Invite error:', authError);
    
    // If user already exists, try to generate a password reset link instead
    if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
      return NextResponse.json({
        success: false,
        error: { 
          message: 'User already exists. They can use the "Forgot Password" option to reset their password.',
          code: 'USER_EXISTS'
        },
      }, { status: 400 });
    }

    // Check for email sending issues
    if (authError.message.includes('email') || authError.message.includes('SMTP') || authError.message.includes('mail')) {
      return NextResponse.json({
        success: false,
        error: { 
          message: 'Email service is not configured in Supabase. Please configure SMTP settings in your Supabase dashboard, or use the direct user creation method.',
          code: 'EMAIL_NOT_CONFIGURED'
        },
      }, { status: 400 });
    }
    
    return NextResponse.json(
      { success: false, error: { message: authError.message } },
      { status: 400 }
    );
  }
  
  console.log('[Invite API] Invite sent successfully, user ID:', authData.user?.id);

  // Create user profile
  if (authData.user) {
    const profileResult = await createUserProfile(supabaseAdmin, authData.user.id, email, name, role, clientId);
    if (!profileResult.success) {
      return NextResponse.json({
        success: false,
        error: { message: profileResult.error || 'Failed to create user profile' },
      }, { status: 400 });
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      message: `Invitation email sent to ${email}`,
      userId: authData.user?.id,
    },
  });
}

async function createUserProfile(
  supabaseAdmin: any,
  userId: string,
  email: string,
  name: string | null,
  role: string,
  clientId: string | null
): Promise<{ success: boolean; error?: string }> {
  console.log('[Invite API] Creating user profile:', { userId, email, role, clientId });
  
  // Create user profile in our users table
  const { error: profileError } = await supabaseAdmin
    .from('users')
    .upsert({
      id: userId,
      email: email,
      name: name || null,
      role: role || 'user',
      active: true,
    }, { onConflict: 'id' });

  if (profileError) {
    console.error('[Invite API] Profile creation error:', profileError);
    return { success: false, error: `Failed to create user profile: ${profileError.message}` };
  }
  
  console.log('[Invite API] User profile created successfully');

  // Create workspace membership if clientId provided
  if (clientId) {
    console.log('[Invite API] Creating workspace membership for client:', clientId);
    
    // Check if membership already exists
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('workspace_memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (checkError) {
      console.error('[Invite API] Error checking membership:', checkError);
    }

    if (!existing) {
      const { error: membershipError } = await supabaseAdmin
        .from('workspace_memberships')
        .insert({
          user_id: userId,
          client_id: clientId,
          workspace_role: role === 'admin' ? 'admin' : 'member',
          is_default: true,
        });

      if (membershipError) {
        console.error('[Invite API] Membership creation error:', membershipError);
        return { success: false, error: `Failed to create workspace membership: ${membershipError.message}` };
      }
      
      console.log('[Invite API] Workspace membership created successfully');
    } else {
      console.log('[Invite API] Workspace membership already exists');
    }
  }
  
  return { success: true };
}

// Fallback when service role key is not available
async function createUserDirectly(email: string, name: string | null, role: string, clientId: string | null) {
  // Generate a secure temporary password
  const tempPassword = generateSecurePassword();
  
  console.log('[Invite API] Creating user directly via signup API');
  
  try {
    // Sign up the user via Supabase Auth REST API
    const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: tempPassword,
        data: {
          name: name || null,
          invited_role: role || 'user',
          invited_client_id: clientId || null,
        },
      }),
    });

    const signupData = await signupRes.json();
    console.log('[Invite API] Signup response:', signupRes.status, signupData);

    if (!signupRes.ok) {
      const errorMsg = signupData.msg || signupData.message || signupData.error_description || 'Failed to create user';
      console.error('[Invite API] Signup failed:', errorMsg);
      
      if (errorMsg.includes('already been registered') || errorMsg.includes('already exists')) {
        return NextResponse.json({
          success: false,
          error: { 
            message: 'User already exists with this email.',
            code: 'USER_EXISTS'
          },
        }, { status: 400 });
      }

      // Check for email confirmation requirement
      if (errorMsg.includes('confirm') || errorMsg.includes('verify')) {
        return NextResponse.json({
          success: false,
          error: { 
            message: 'Email confirmation is required. The user has been created but needs to verify their email. Check Supabase dashboard to disable email confirmation if needed.',
            code: 'EMAIL_CONFIRMATION_REQUIRED'
          },
        }, { status: 400 });
      }
      
      return NextResponse.json(
        { success: false, error: { message: errorMsg } },
        { status: 400 }
      );
    }

    const userId = signupData.id || signupData.user?.id;

    if (userId) {
      console.log('[Invite API] User signed up, creating profile for:', userId);
      
      // Create user profile via REST API
      const profileRes = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          id: userId,
          email,
          name: name || null,
          role: role || 'user',
          active: true,
        }),
      });

      if (!profileRes.ok) {
        const profileError = await profileRes.text();
        console.error('[Invite API] Profile creation failed:', profileRes.status, profileError);
        // Don't fail completely - the user was created in Supabase Auth
        // They just won't have a profile row yet
      } else {
        console.log('[Invite API] Profile created successfully');
      }

      // Create workspace membership if clientId provided
      if (clientId) {
        console.log('[Invite API] Creating workspace membership');
        const membershipRes = await fetch(`${supabaseUrl}/rest/v1/workspace_memberships`, {
          method: 'POST',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            user_id: userId,
            client_id: clientId,
            workspace_role: role === 'admin' ? 'admin' : 'member',
            is_default: true,
          }),
        });

        if (!membershipRes.ok) {
          const membershipError = await membershipRes.text();
          console.error('[Invite API] Membership creation failed:', membershipRes.status, membershipError);
        } else {
          console.log('[Invite API] Membership created successfully');
        }
      }
    } else {
      console.log('[Invite API] No user ID returned from signup');
    }

    console.log('[Invite API] User created successfully:', userId);
    
    return NextResponse.json({
      success: true,
      data: {
        message: `Account created for ${email}.`,
        userId,
        tempPassword, // Return temp password so it can be shared securely
        note: 'Share the temporary password with the user securely. They should change it after first login.',
      },
    });

  } catch (error) {
    console.error('Direct create error:', error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : 'Failed to create user' } },
      { status: 500 }
    );
  }
}

function generateSecurePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure at least one of each type
  password = password.slice(0, 12) + 'Aa1!';
  return password;
}
