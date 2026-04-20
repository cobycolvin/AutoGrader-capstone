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
  MoreVertRounded,
} from '@mui/icons-material'

function RowActionsMenu({
  items,
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
    event.stopPropagation()
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleAction = (action) => {
    handleClose()
    action?.()
  }

  const normalizedItems = Array.isArray(items) && items.length
    ? items
    : [
        onEdit
          ? {
              key: 'edit',
              label: editLabel,
              onClick: onEdit,
              icon: <EditRounded fontSize="small" />,
              disabled: false,
            }
          : null,
        onDelete
          ? {
              key: 'delete',
              label: deleteLabel,
              onClick: onDelete,
              icon: <DeleteRounded fontSize="small" color="error" />,
              disabled: deleteDisabled,
            }
          : null,
      ].filter(Boolean)

  if (!normalizedItems.length) {
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
        <MoreVertRounded fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {normalizedItems.map((item, index) => (
          <MenuItem
            key={item.key || item.label || index}
            onClick={() => handleAction(item.onClick)}
            disabled={item.disabled}
          >
            {item.icon ? (
              <ListItemIcon>
                {item.icon}
              </ListItemIcon>
            ) : null}
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export default RowActionsMenu
