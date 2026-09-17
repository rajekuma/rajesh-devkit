# Auth and a users table already exist, so "email verification on signup"
# touches an auth boundary AND the data model - two of the five SENSITIVE
# categories. The spec must carry the marker.
cat > src/users.js <<'EOS'
// In-memory users table. Columns: id, email, passwordHash, createdAt.
const users = [];
function signup(email, passwordHash) {
  if (users.some(u => u.email === email)) throw new Error('email taken');
  const u = { id: users.length + 1, email, passwordHash, createdAt: Date.now() };
  users.push(u);
  return u;
}
function login(email, passwordHash) {
  const u = users.find(x => x.email === email && x.passwordHash === passwordHash);
  if (!u) throw new Error('invalid credentials');
  return { token: 'tok-' + u.id };
}
module.exports = { signup, login, users };
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm baseline
