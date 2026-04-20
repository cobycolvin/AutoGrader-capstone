export const ASSIGNMENT_SUBMISSION_MODE = {
  UPLOAD: 'UPLOAD',
  WORKSPACE: 'WORKSPACE',
  BOTH: 'BOTH',
}

export const normalizeAssignmentSubmissionMode = (value) => {
  const mode = String(value || '').toUpperCase()
  if (mode === ASSIGNMENT_SUBMISSION_MODE.UPLOAD) return ASSIGNMENT_SUBMISSION_MODE.UPLOAD
  if (mode === ASSIGNMENT_SUBMISSION_MODE.WORKSPACE) return ASSIGNMENT_SUBMISSION_MODE.WORKSPACE
  return ASSIGNMENT_SUBMISSION_MODE.BOTH
}

export const allowsUploadSubmission = (assignment) => {
  const mode = normalizeAssignmentSubmissionMode(assignment?.submission_mode)
  return mode === ASSIGNMENT_SUBMISSION_MODE.UPLOAD || mode === ASSIGNMENT_SUBMISSION_MODE.BOTH
}

export const allowsWorkspaceSubmission = (assignment) => {
  const mode = normalizeAssignmentSubmissionMode(assignment?.submission_mode)
  return (
    (mode === ASSIGNMENT_SUBMISSION_MODE.WORKSPACE || mode === ASSIGNMENT_SUBMISSION_MODE.BOTH)
    && Boolean(assignment?.language || assignment?.language_name)
  )
}

export const getAssignmentSubmissionModeLabel = (assignment) => {
  const mode = normalizeAssignmentSubmissionMode(assignment?.submission_mode)
  if (mode === ASSIGNMENT_SUBMISSION_MODE.UPLOAD) return 'Upload only'
  if (mode === ASSIGNMENT_SUBMISSION_MODE.WORKSPACE) return 'Workspace only'
  return 'Upload or workspace'
}
