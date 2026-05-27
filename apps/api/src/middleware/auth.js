export function requireUser(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

export function attachDevUser(store) {
  return (req, _res, next) => {
    if (process.env.NODE_ENV !== 'production' && !req.session.userId) {
      let user = store.findUserByUsername('demo');
      if (!user) user = store.createUser({ username: 'demo', displayName: 'Demo User', preferredLanguage: 'en' });
      req.session.userId = user.id;
    }
    next();
  };
}
