function allowedUsers() {
  return new Set(
    (process.env.AUTH_ALLOWED_USERS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function sendError(response, status, message) {
  response.status(status).json({ message });
}

export function accessControl(request, response, next) {
  const mode = (process.env.AUTH_MODE || 'none').trim().toLowerCase();
  if (mode === 'none') {
    request.operator = 'local';
    next();
    return;
  }

  if (mode !== 'proxy') {
    sendError(response, 500, '服务访问控制配置无效。');
    return;
  }

  const headerName = (process.env.AUTH_USER_HEADER || 'x-erp-user').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(headerName)) {
    sendError(response, 500, '服务访问控制配置无效。');
    return;
  }

  const operator = request.get(headerName)?.trim();
  if (!operator || operator.length > 100) {
    sendError(response, 401, '请通过公司统一登录入口访问此工具。');
    return;
  }

  const allowlist = allowedUsers();
  if (allowlist.size > 0 && !allowlist.has(operator)) {
    sendError(response, 403, '当前账号没有使用此工具的权限。');
    return;
  }

  request.operator = operator;
  next();
}
