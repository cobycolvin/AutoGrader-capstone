import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const getCookie = (name) => {
  if (typeof document === 'undefined') {
    return ''
  }
  const match = document.cookie.match(new RegExp(`(^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[2]) : ''
}

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
})

const isWriteMethod = (method) => ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase())

const ensureCsrfToken = async () => {
  if (getCookie('csrftoken')) {
    return getCookie('csrftoken')
  }
  await api.get('/api/csrf/')
  return getCookie('csrftoken')
}

export const apiRequest = async (path, options = {}) => {
  const method = options.method || 'GET'
  const normalizedMethod = method.toLowerCase()
  const headers = options.headers || {}
  const data = options.body
    ? typeof options.body === 'string'
      ? JSON.parse(options.body)
      : options.body
    : options.data

  if (isWriteMethod(normalizedMethod)) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken
    }
  }

  try {
    const response = await api.request({
      url: path,
      method: normalizedMethod,
      data,
      headers,
    })
    return response.data
  } catch (error) {
    const message =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      'Request failed'
    const err = new Error(message)
    err.status = error?.response?.status
    err.payload = error?.response?.data
    throw err
  }
}

export { API_BASE }
