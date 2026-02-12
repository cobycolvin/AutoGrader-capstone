import { useState } from 'react'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import {
  DeleteRounded,
  EditRounded,
  MoreHorizRounded,
} from '@mui/icons-material'

function RowActionsMenu({
  onEdit,
  onDelete,
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  disabled = false,
  deleteDisabled = false,
}) {
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleEdit = () => {
    handleClose()
    onEdit?.()
  }

  const handleDelete = () => {
    handleClose()
    onDelete?.()
  }

  if (!onEdit && !onDelete) {
    return null
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={handleOpen}
        disabled={disabled}
        aria-label="Open row actions"
      >
        <MoreHorizRounded fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {onEdit ? (
          <MenuItem onClick={handleEdit}>
            <ListItemIcon>
              <EditRounded fontSize="small" />
            </ListItemIcon>
            <ListItemText>{editLabel}</ListItemText>
          </MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem onClick={handleDelete} disabled={deleteDisabled}>
            <ListItemIcon>
              <DeleteRounded fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>{deleteLabel}</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>
    </>
  )
}

export default RowActionsMenu
