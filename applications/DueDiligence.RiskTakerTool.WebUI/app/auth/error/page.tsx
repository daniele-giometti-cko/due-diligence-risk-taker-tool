export default function AuthError({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h2>Sign-in error</h2>
      <p style={{ color: '#c0392b' }}>
        {searchParams.error === 'access_denied'
          ? 'Access denied. You may not have permission to use this tool.'
          : 'Something went wrong during sign-in. Please try again.'}
      </p>
      <a href="/api/auth/okta/login">Try again</a>
    </div>
  );
}
