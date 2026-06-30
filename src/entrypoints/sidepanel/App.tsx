import React, { useState, useEffect, useRef } from 'react'
import { Play, Square, Save, Trash2, Shield, Users, Layers, AlertCircle, FileText } from 'lucide-react'

interface GroupInfo {
  id: string
  name: string
}

interface LogEntry {
  id: string
  timestamp: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

export default function App() {
  const [groupId, setGroupId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [savedGroups, setSavedGroups] = useState<GroupInfo[]>([])
  const [activeGroupId, setActiveGroupId] = useState('')
  const [autoModEnabled, setAutoModEnabled] = useState(false)
  
  // Stats
  const [stats, setStats] = useState({
    checked: 0,
    suspended: 0,
    skipped: 0
  })

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  // Initialize and load from storage
  useEffect(() => {
    chrome.storage.local.get(['savedGroups', 'activeGroupId', 'autoModEnabled', 'stats'], (result) => {
      if (result.savedGroups) setSavedGroups(result.savedGroups)
      if (result.activeGroupId) {
        setActiveGroupId(result.activeGroupId)
        setGroupId(result.activeGroupId)
        const found = (result.savedGroups || []).find((g: GroupInfo) => g.id === result.activeGroupId)
        if (found) setGroupName(found.name)
      }
      if (result.autoModEnabled) setAutoModEnabled(result.autoModEnabled)
      if (result.stats) setStats(result.stats)
    })

    // Listen for log and stats updates from background or content script
    const listener = (message: any) => {
      if (message.type === 'ADD_LOG') {
        addLog(message.text, message.logType || 'info')
      } else if (message.type === 'UPDATE_STATS') {
        setStats(prev => {
          const next = {
            checked: prev.checked + (message.stats.checked || 0),
            suspended: prev.suspended + (message.stats.suspended || 0),
            skipped: prev.skipped + (message.stats.skipped || 0)
          }
          chrome.storage.local.set({ stats: next })
          return next
        })
      } else if (message.type === 'SYNC_STATE') {
        if (message.autoModEnabled !== undefined) {
          setAutoModEnabled(message.autoModEnabled)
        }
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const newEntry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }
    setLogs(prev => [...prev, newEntry].slice(-100)) // Keep last 100 logs
  }

  const handleSaveGroup = () => {
    if (!groupId.trim()) {
      addLog('Group ID cannot be empty', 'error')
      return
    }
    const name = groupName.trim() || `Group ${groupId}`
    const existingIndex = savedGroups.findIndex(g => g.id === groupId)
    let nextGroups = [...savedGroups]
    if (existingIndex >= 0) {
      nextGroups[existingIndex] = { id: groupId, name }
      addLog(`Updated group: ${name}`, 'info')
    } else {
      nextGroups.push({ id: groupId, name })
      addLog(`Saved group: ${name}`, 'success')
    }
    setSavedGroups(nextGroups)
    chrome.storage.local.set({ savedGroups: nextGroups })
  }

  const handleDeleteGroup = (idToDelete: string) => {
    const nextGroups = savedGroups.filter(g => g.id !== idToDelete)
    setSavedGroups(nextGroups)
    addLog(`Deleted group with ID: ${idToDelete}`, 'warning')
    chrome.storage.local.set({ savedGroups: nextGroups })
    if (activeGroupId === idToDelete) {
      setActiveGroupId('')
      setGroupId('')
      setGroupName('')
      chrome.storage.local.set({ activeGroupId: '' })
    }
  }

  const handleSelectGroup = (id: string) => {
    setActiveGroupId(id)
    setGroupId(id)
    const found = savedGroups.find(g => g.id === id)
    if (found) {
      setGroupName(found.name)
    }
    chrome.storage.local.set({ activeGroupId: id })
    addLog(`Selected active Group ID: ${id}`, 'info')
  }

  const handleToggleAutoMod = () => {
    const nextState = !autoModEnabled
    if (nextState && !groupId) {
      addLog('Please select or input a Group ID first', 'error')
      return
    }
    setAutoModEnabled(nextState)
    chrome.storage.local.set({ autoModEnabled: nextState })
    
    // Notify background/content scripts
    chrome.runtime.sendMessage({
      type: 'TOGGLE_AUTOMOD',
      enabled: nextState,
      groupId: groupId
    })

    if (nextState) {
      addLog(`Auto-Mod started for Group ${groupId}`, 'success')
    } else {
      addLog('Auto-Mod stopped', 'warning')
    }
  }

  const handleResetStats = () => {
    const initialStats = { checked: 0, suspended: 0, skipped: 0 }
    setStats(initialStats)
    chrome.storage.local.set({ stats: initialStats })
    addLog('Stats counters reset', 'info')
  }

  return (
    <div className="flex flex-col h-screen max-h-screen bg-background text-foreground select-none p-4">
      {/* Group Configuration */}
      <div className="flex flex-col gap-3 p-3 bg-card rounded-lg border border-border shadow-sm">
        <h2 className="text-sm font-semibold flex items-center gap-1">
          <Layers className="w-4 h-4 text-muted-foreground" />
          Group Configuration
        </h2>

        {/* Input fields */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xxs font-medium text-muted-foreground">Group ID</label>
              <input
                type="text"
                placeholder="e.g. bayareahouse"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                disabled={autoModEnabled}
                className="w-full text-xs px-2 py-1.5 bg-background border border-border rounded focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xxs font-medium text-muted-foreground">Friendly Name (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Bay Area Rental"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                disabled={autoModEnabled}
                className="w-full text-xs px-2 py-1.5 bg-background border border-border rounded focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
          </div>

          <button
            onClick={handleSaveGroup}
            disabled={autoModEnabled}
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-secondary text-secondary-foreground hover:bg-muted text-xs font-semibold rounded transition disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save Group Configuration
          </button>
        </div>

        {/* Dropdown for previous IDs */}
        {savedGroups.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2 mt-1">
            <label className="text-xxs font-medium text-muted-foreground">Saved Groups</label>
            <div className="flex gap-1">
              <select
                value={activeGroupId}
                onChange={(e) => handleSelectGroup(e.target.value)}
                disabled={autoModEnabled}
                className="flex-1 text-xs px-2 py-1.5 bg-background border border-border rounded focus:outline-none disabled:opacity-50"
              >
                <option value="">-- Select Saved Group --</option>
                {savedGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.id})
                  </option>
                ))}
              </select>

              {activeGroupId && (
                <button
                  onClick={() => handleDeleteGroup(activeGroupId)}
                  disabled={autoModEnabled}
                  className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded transition disabled:opacity-50 cursor-pointer"
                  title="Delete current group"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Control Actions */}
      <div className="mt-4 flex flex-col gap-3 p-3 bg-card rounded-lg border border-border shadow-sm">
        <h2 className="text-sm font-semibold flex items-center gap-1">
          <Users className="w-4 h-4 text-muted-foreground" />
          Moderation Status
        </h2>

        {/* Action Toggle */}
        <button
          onClick={handleToggleAutoMod}
          className={`flex items-center justify-center gap-2 py-2 px-4 rounded font-bold text-sm transition cursor-pointer text-white ${
            autoModEnabled
              ? 'bg-destructive hover:bg-destructive-foreground animate-pulse'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
        >
          {autoModEnabled ? (
            <>
              <Square className="w-4 h-4 fill-white" />
              Stop Auto-Moderation
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-primary-foreground" />
              Start Auto-Moderation
            </>
          )}
        </button>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 mt-1 text-center">
          <div className="bg-background border border-border p-2 rounded">
            <p className="text-xxs font-medium text-muted-foreground">Checked</p>
            <p className="text-lg font-bold">{stats.checked}</p>
          </div>
          <div className="bg-success/5 border border-success/20 p-2 rounded">
            <p className="text-xxs font-medium text-success text-center">Suspended</p>
            <p className="text-lg font-bold text-success">{stats.suspended}</p>
          </div>
          <div className="bg-warning/5 border border-warning/20 p-2 rounded">
            <p className="text-xxs font-medium text-warning text-center">Skipped</p>
            <p className="text-lg font-bold text-warning">{stats.skipped}</p>
          </div>
        </div>

        {/* Reset stats */}
        <button
          onClick={handleResetStats}
          disabled={autoModEnabled}
          className="text-center text-xxs text-muted-foreground hover:text-foreground underline transition cursor-pointer disabled:opacity-50"
        >
          Reset Stats Counters
        </button>
      </div>

      {/* Log Console */}
      <div className="mt-4 flex-1 flex flex-col gap-2 p-3 bg-black text-green-400 font-mono rounded-lg border border-border shadow-sm overflow-hidden text-xs select-text">
        <div className="flex items-center justify-between pb-1 border-b border-green-900">
          <span className="flex items-center gap-1 font-semibold text-xxs">
            <FileText className="w-3 h-3" />
            CONSOLE LOGS
          </span>
          <button
            onClick={() => setLogs([])}
            className="text-xxs text-green-600 hover:text-green-300 transition"
          >
            Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1 font-mono leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-green-700 italic text-center pt-8">Console is waiting for actions...</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-1.5 items-start">
                <span className="text-green-700 text-xxs shrink-0 select-none">[{log.timestamp}]</span>
                <span
                  className={`${
                    log.type === 'success'
                      ? 'text-green-300'
                      : log.type === 'warning'
                      ? 'text-yellow-400'
                      : log.type === 'error'
                      ? 'text-red-400 font-semibold'
                      : 'text-green-400'
                  }`}
                >
                  {log.message}
                </span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
