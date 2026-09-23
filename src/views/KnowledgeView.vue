<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { api, ApiError, type KbDocument, type KnowledgeBase } from '@/api/client'
import { useAuth } from '@/auth'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

const auth = useAuth()
const projects = ref<string[]>([])
const runnerOnline = ref(true)
const filter = ref('all')
const bases = ref<KnowledgeBase[]>([])
const selectedId = ref<number | null>(null)
const documents = ref<KbDocument[]>([])
const loading = ref(true)
const loadingDocs = ref(false)
const uploading = ref(false)
const error = ref('')
const formOpen = ref(false)
const formSaving = ref(false)
const editingId = ref<number | null>(null)

const name = ref('')
const slug = ref('')
const project = ref('')
const description = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

function selectedBase(): KnowledgeBase | null {
  return bases.value.find((b) => b.id === selectedId.value) ?? null
}

async function loadMeta() {
  const token = auth.getAccessToken()
  if (!token) return
  try {
    const res = await api.getModels(token)
    runnerOnline.value = res.runner_online
    projects.value = res.kb_projects ?? res.agent_projects ?? []
  } catch {
    // KB CRUD works offline; ingest waits for the runner.
  }
}

function listParams() {
  const params: { project?: string } = {}
  if (filter.value === '_none') params.project = '_none'
  else if (filter.value !== 'all') params.project = filter.value
  return params
}

async function loadBases() {
  const token = auth.getAccessToken()
  if (!token) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.listKnowledgeBases(listParams(), token)
    bases.value = res.bases
    if (selectedId.value !== null && !bases.value.some((b) => b.id === selectedId.value)) {
      selectedId.value = null
      documents.value = []
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load knowledge bases'
  } finally {
    loading.value = false
  }
}

async function loadDocuments() {
  const token = auth.getAccessToken()
  if (!token || selectedId.value === null) {
    documents.value = []
    return
  }
  loadingDocs.value = true
  try {
    const res = await api.listKbDocuments(selectedId.value, token)
    documents.value = res.documents
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load documents'
  } finally {
    loadingDocs.value = false
  }
}

function openCreate() {
  editingId.value = null
  name.value = ''
  slug.value = ''
  description.value = ''
  project.value = filter.value !== 'all' && filter.value !== '_none' ? filter.value : ''
  formOpen.value = true
  error.value = ''
}

function openEdit(base: KnowledgeBase) {
  editingId.value = base.id
  name.value = base.name
  slug.value = base.slug
  description.value = base.description ?? ''
  project.value = base.project ?? ''
  formOpen.value = true
  error.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

async function saveForm() {
  const token = auth.getAccessToken()
  if (!token) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = 'Name is required'
    return
  }
  const proj = project.value.trim()
  if (proj && !PROJECT_RE.test(proj)) {
    error.value = 'Invalid project name'
    return
  }
  const slugVal = slug.value.trim()
  if (slugVal && !PROJECT_RE.test(slugVal)) {
    error.value = 'Invalid slug'
    return
  }
  formSaving.value = true
  error.value = ''
  try {
    if (editingId.value === null) {
      const created = await api.createKnowledgeBase(
        {
          name: trimmed,
          slug: slugVal || undefined,
          project: proj || null,
          description: description.value.trim() || null,
        },
        token,
      )
      closeForm()
      await loadMeta()
      await loadBases()
      selectedId.value = created.id
      await loadDocuments()
    } else {
      await api.updateKnowledgeBase(
        editingId.value,
        {
          name: trimmed,
          slug: slugVal || undefined,
          project: proj || null,
          description: description.value.trim() || null,
        },
        token,
      )
      closeForm()
      await loadMeta()
      await loadBases()
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Save failed'
  } finally {
    formSaving.value = false
  }
}

async function removeBase() {
  const token = auth.getAccessToken()
  if (!token || editingId.value === null) return
  if (!confirm('Delete this knowledge base and all of its documents?')) return
  formSaving.value = true
  error.value = ''
  try {
    await api.deleteKnowledgeBase(editingId.value, token)
    if (selectedId.value === editingId.value) {
      selectedId.value = null
      documents.value = []
    }
    closeForm()
    await loadBases()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed'
  } finally {
    formSaving.value = false
  }
}

async function selectBase(base: KnowledgeBase) {
  selectedId.value = base.id
  await loadDocuments()
}

async function onFilesSelected(ev: Event) {
  const token = auth.getAccessToken()
  const input = ev.target as HTMLInputElement
  const files = input.files
  if (!token || !files?.length || selectedId.value === null) return
  uploading.value = true
  error.value = ''
  try {
    for (const file of Array.from(files)) {
      await api.uploadKbDocument(selectedId.value, file, token)
    }
    await loadDocuments()
    await loadBases()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Upload failed'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function retryDoc(doc: KbDocument) {
  const token = auth.getAccessToken()
  if (!token) return
  error.value = ''
  try {
    await api.reingestKbDocument(doc.id, token)
    await loadDocuments()
    await loadBases()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Re-ingest failed'
  }
}

async function deleteDoc(doc: KbDocument) {
  const token = auth.getAccessToken()
  if (!token) return
  if (!confirm(`Delete ${doc.filename}?`)) return
  error.value = ''
  try {
    await api.deleteKbDocument(doc.id, token)
    await loadDocuments()
    await loadBases()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed'
  }
}

async function rebuildSelected() {
  const token = auth.getAccessToken()
  if (!token || selectedId.value === null) return
  if (!confirm('Re-queue ingest for all documents in this knowledge base?')) return
  error.value = ''
  try {
    await api.rebuildKnowledgeBase(selectedId.value, token)
    await loadDocuments()
    await loadBases()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Rebuild failed'
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status: string): string {
  return status
}

watch(filter, async () => {
  selectedId.value = null
  documents.value = []
  await loadBases()
})

onMounted(async () => {
  await loadMeta()
  await loadBases()
  pollTimer = setInterval(async () => {
    await loadMeta()
    if (selectedId.value !== null) {
      const hasActive = documents.value.some((d) =>
        ['pending', 'queued', 'running', 'deleting'].includes(d.status),
      )
      if (hasActive) {
        await loadDocuments()
        await loadBases()
      }
    }
  }, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div>
    <div class="journal-toolbar">
      <h2 style="margin: 0">Knowledge</h2>
      <button type="button" class="btn btn-primary" @click="openCreate">New knowledge base</button>
    </div>

    <p v-if="!runnerOnline" class="muted">
      Runner offline — uploads are accepted; ingest will run when the runner is back.
    </p>

    <div class="journal-filters">
      <label>
        Project
        <select v-model="filter">
          <option value="all">All</option>
          <option value="_none">Global</option>
          <option v-for="p in projects" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <div v-else class="kb-layout">
      <div class="kb-list">
        <p v-if="!bases.length" class="muted">No knowledge bases yet.</p>
        <button
          v-for="base in bases"
          :key="base.id"
          type="button"
          class="card journal-row kb-base-row"
          :class="{ 'kb-selected': base.id === selectedId }"
          @click="selectBase(base)"
        >
          <div class="kb-base-title">
            <strong>{{ base.name }}</strong>
            <span v-if="base.project" class="journal-project">{{ base.project }}</span>
            <span v-else class="muted">global</span>
          </div>
          <div class="muted kb-meta">
            {{ base.slug }} · {{ base.ready_count }} ready
            <span v-if="base.pending_count"> · {{ base.pending_count }} pending</span>
            <span v-if="base.failed_count"> · {{ base.failed_count }} failed</span>
          </div>
          <div class="actions" @click.stop>
            <button type="button" class="btn" @click="openEdit(base)">Edit</button>
          </div>
        </button>
      </div>

      <div class="kb-detail">
        <template v-if="selectedBase()">
          <div class="journal-toolbar">
            <h3 style="margin: 0">{{ selectedBase()!.name }}</h3>
            <div class="actions">
              <button type="button" class="btn" :disabled="uploading" @click="fileInput?.click()">
                {{ uploading ? 'Uploading…' : 'Upload' }}
              </button>
              <button type="button" class="btn" @click="rebuildSelected">Rebuild</button>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept=".pdf,.docx,.epub,.md,.markdown,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/x-markdown,text/plain"
              multiple
              hidden
              @change="onFilesSelected"
            />
          </div>
          <p class="muted">PDF, DOCX, EPUB, Markdown, or TXT. Agents search this corpus with kb_search.</p>
          <p v-if="loadingDocs" class="muted">Loading documents…</p>
          <p v-else-if="!documents.length" class="muted">No documents yet.</p>
          <div v-for="doc in documents" :key="doc.id" class="card journal-row">
            <div class="kb-base-title">
              <strong>{{ doc.filename }}</strong>
              <span class="journal-project">{{ statusLabel(doc.status) }}</span>
            </div>
            <div class="muted kb-meta">
              {{ doc.format.toUpperCase() }} · {{ formatBytes(doc.size_bytes) }}
              <span v-if="doc.chunk_count != null"> · {{ doc.chunk_count }} chunks</span>
              <span v-if="doc.page_count"> · {{ doc.page_count }} pages</span>
            </div>
            <p v-if="doc.error_message" class="error">{{ doc.error_message }}</p>
            <div class="actions">
              <button
                v-if="doc.status === 'failed' || doc.status === 'ready'"
                type="button"
                class="btn"
                @click="retryDoc(doc)"
              >
                {{ doc.status === 'failed' ? 'Retry' : 'Re-ingest' }}
              </button>
              <button
                v-if="doc.status !== 'deleting'"
                type="button"
                class="btn btn-danger"
                @click="deleteDoc(doc)"
              >
                Delete
              </button>
            </div>
          </div>
        </template>
        <p v-else class="muted">Select a knowledge base to manage documents.</p>
      </div>
    </div>

    <div v-if="formOpen" class="journal-modal" @click.self="closeForm">
      <form class="card journal-form" @submit.prevent="saveForm">
        <h3>{{ editingId === null ? 'New knowledge base' : 'Edit knowledge base' }}</h3>
        <div class="form-group">
          <label>Name</label>
          <input v-model="name" type="text" required maxlength="80" />
        </div>
        <div class="form-group">
          <label>Slug <span class="muted">(optional)</span></label>
          <input v-model="slug" type="text" maxlength="64" placeholder="auto from name" />
        </div>
        <div class="form-group">
          <label>Project <span class="muted">(blank = global)</span></label>
          <input v-model="project" type="text" list="kb-project-list" maxlength="64" />
          <datalist id="kb-project-list">
            <option v-for="p in projects" :key="p" :value="p" />
          </datalist>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea v-model="description" rows="3" maxlength="500" />
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary" :disabled="formSaving">
            {{ formSaving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="btn" :disabled="formSaving" @click="closeForm">Cancel</button>
          <button
            v-if="editingId !== null"
            type="button"
            class="btn btn-danger"
            :disabled="formSaving"
            @click="removeBase"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.kb-layout {
  display: grid;
  gap: 1rem;
}
@media (min-width: 720px) {
  .kb-layout {
    grid-template-columns: 1fr 1.4fr;
    align-items: start;
  }
}
.kb-base-row {
  width: 100%;
  text-align: left;
  cursor: pointer;
}
.kb-selected {
  outline: 1px solid #2563eb;
}
.kb-base-title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}
.kb-meta {
  font-size: 0.9rem;
  margin-top: 0.25rem;
}
</style>
