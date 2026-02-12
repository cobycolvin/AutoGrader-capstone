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
  headers: {},
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
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData

  if (isWriteMethod(normalizedMethod)) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken
    }
  }
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
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

export const downloadFile = async (path, options = {}) => {
  const method = options.method || 'GET'
  const normalizedMethod = method.toLowerCase()
  const headers = options.headers || {}
  const data = options.body ?? options.data
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData

  if (isWriteMethod(normalizedMethod)) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken
    }
  }
  if (!isFormData && data && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await api.request({
    url: path,
    method: normalizedMethod,
    data,
    headers,
    responseType: 'blob',
  })

  let filename = options.filename
  const disposition = response.headers?.['content-disposition']
  if (!filename && disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/)
    if (match) {
      filename = match[1]
    }
  }
  const blob = response.data
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export { API_BASE }
