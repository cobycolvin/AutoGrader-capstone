import { useEffect, useState } from 'react'
import {
  Box,
  Divider,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  CodeRounded,
  FormatBoldRounded,
  FormatClearRounded,
  FormatItalicRounded,
  FormatListBulletedRounded,
  FormatListNumberedRounded,
  FormatQuoteRounded,
  FormatUnderlinedRounded,
  HorizontalRuleRounded,
  LinkRounded,
  RedoRounded,
  StrikethroughSRounded,
  UndoRounded,
} from '@mui/icons-material'
import { EditorContent, useEditor } from '@tiptap/react'
import CharacterCount from '@tiptap/extension-character-count'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'

function getEditorValue(editor) {
  if (!editor || editor.isEmpty) return ''
  return editor.getHTML()
}

export default function AssignmentInstructionsEditor({
  value = '',
  onChange,
  label = 'Student instructions',
  helperText = '',
  placeholder = 'Start writing instructions...',
  minHeight = 240,
}) {
  const [editorTick, setEditorTick] = useState(0)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value || '',
  })

  useEffect(() => {
    if (!editor || typeof onChange !== 'function') return undefined
    const handleUpdate = () => onChange(getEditorValue(editor))
    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
    }
  }, [editor, onChange])

  useEffect(() => {
    if (!editor) return
    const currentValue = getEditorValue(editor)
    const nextValue = value || ''
    if (currentValue !== nextValue) {
      editor.commands.setContent(nextValue, false)
    }
  }, [editor, value])

  useEffect(() => {
    if (!editor) return undefined
    const trigger = () => setEditorTick((tick) => tick + 1)
    editor.on('selectionUpdate', trigger)
    editor.on('transaction', trigger)
    return () => {
      editor.off('selectionUpdate', trigger)
      editor.off('transaction', trigger)
    }
  }, [editor])

  return (
    <Stack spacing={1.25}>
      {label || helperText ? (
        <Stack spacing={0.5}>
          {label ? (
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {label}
            </Typography>
          ) : null}
          {helperText ? <Typography variant="body2" color="text.secondary">{helperText}</Typography> : null}
        </Stack>
      ) : null}
      <Paper
        variant="outlined"
        data-editor-tick={editorTick}
        sx={{
          px: 1,
          py: 0.5,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          flexWrap: 'wrap',
          backgroundColor: 'rgba(248, 250, 252, 0.9)',
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={
            editor?.isActive('heading', { level: 1 })
              ? 'h1'
              : editor?.isActive('heading', { level: 2 })
                ? 'h2'
                : editor?.isActive('heading', { level: 3 })
                  ? 'h3'
                  : 'paragraph'
          }
          onChange={(_event, nextValue) => {
            if (!nextValue) return
            if (nextValue === 'paragraph') {
              editor?.chain().focus().setParagraph().run()
              return
            }
            const level = Number(nextValue.replace('h', ''))
            editor?.chain().focus().toggleHeading({ level }).run()
          }}
          sx={{ mr: 0.5 }}
        >
          <ToggleButton value="paragraph">P</ToggleButton>
          <ToggleButton value="h1">H1</ToggleButton>
          <ToggleButton value="h2">H2</ToggleButton>
          <ToggleButton value="h3">H3</ToggleButton>
        </ToggleButtonGroup>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Tooltip title="Bold">
          <IconButton
            size="small"
            color={editor?.isActive('bold') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <FormatBoldRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Italic">
          <IconButton
            size="small"
            color={editor?.isActive('italic') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <FormatItalicRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Strikethrough">
          <IconButton
            size="small"
            color={editor?.isActive('strike') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <StrikethroughSRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Underline">
          <IconButton
            size="small"
            color={editor?.isActive('underline') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <FormatUnderlinedRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Tooltip title="Bulleted list">
          <IconButton
            size="small"
            color={editor?.isActive('bulletList') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <FormatListBulletedRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Numbered list">
          <IconButton
            size="small"
            color={editor?.isActive('orderedList') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <FormatListNumberedRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Quote">
          <IconButton
            size="small"
            color={editor?.isActive('blockquote') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <FormatQuoteRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Code block">
          <IconButton
            size="small"
            color={editor?.isActive('codeBlock') ? 'primary' : 'default'}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <CodeRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Divider">
          <IconButton size="small" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
            <HorizontalRuleRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Tooltip title="Insert link">
          <IconButton
            size="small"
            onClick={() => {
              const url = window.prompt('Enter link URL')
              if (url) {
                editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
              }
            }}
          >
            <LinkRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="Undo">
            <IconButton size="small" onClick={() => editor?.chain().focus().undo().run()}>
              <UndoRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Redo">
            <IconButton size="small" onClick={() => editor?.chain().focus().redo().run()}>
              <RedoRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Tooltip title="Clear formatting">
          <IconButton size="small" onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}>
            <FormatClearRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5 }}>
          {editor?.storage.characterCount?.words() || 0} words
        </Typography>
      </Paper>
      <Paper
        variant="outlined"
        sx={{
          minHeight,
          p: 2,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
        }}
      >
        <Box
          sx={{
            '& .ProseMirror': {
              minHeight: Math.max(minHeight - 48, 120),
              outline: 'none',
            },
            '& .ProseMirror p': { mt: 0, mb: 1.25 },
            '& .ProseMirror ul, & .ProseMirror ol': { pl: 2.5, mb: 1.25 },
            '& .ProseMirror li': { mb: 0.5 },
            '& .ProseMirror a': { color: 'primary.main' },
            '& .ProseMirror code': {
              fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
              backgroundColor: 'rgba(15, 23, 42, 0.06)',
              px: 0.5,
              borderRadius: 0.75,
            },
          }}
        >
          <EditorContent editor={editor} />
        </Box>
      </Paper>
    </Stack>
  )
}
