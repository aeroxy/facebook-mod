let autoModEnabled = false
let activeGroupId = ''
let isChecking = false
let currentTabId: number | null = null
let currentTask: { url: string; userName: string } | null = null
let checkTimeoutId: any = null
let scraperTabId: number | null = null

function logToSidepanel(text: string, logType: 'info' | 'success' | 'warning' | 'error' = 'info') {
  console.log(`[FB-Mod Log] ${text}`)
  chrome.runtime.sendMessage({
    type: 'ADD_LOG',
    text,
    logType
  }).catch(() => {})
}

function updateStatsInSidepanel(stats: { checked?: number; suspended?: number; skipped?: number }) {
  chrome.runtime.sendMessage({
    type: 'UPDATE_STATS',
    stats
  }).catch(() => {})
}

// Persist the auto mod state to chrome local storage so it matches sidepanel state
function saveState() {
  chrome.storage.local.set({ autoModEnabled })
  chrome.runtime.sendMessage({
    type: 'SYNC_STATE',
    autoModEnabled
  }).catch(() => {})
}

function getCleanUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return url
  }
}

function requestNextProfile() {
  if (!autoModEnabled || scraperTabId === null) return
  chrome.tabs.sendMessage(scraperTabId, { type: 'REQUEST_NEXT_PROFILE' }).catch(() => {
    console.warn('[Facebook Mod] Failed to request next profile from scraper tab')
  })
}

export default defineBackground(() => {
  console.log('[Facebook Mod] Background service worker initialized')

  // Set side panel to open on action button click
  if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.error('[Facebook Mod] Failed to set panel behavior:', err)
    })
  }

  // Listen for storage changes or initial state loading
  chrome.storage.local.get(['autoModEnabled', 'activeGroupId'], (result) => {
    if (result.autoModEnabled !== undefined) {
      autoModEnabled = result.autoModEnabled
    }
    if (result.activeGroupId !== undefined) {
      activeGroupId = result.activeGroupId
    }
  })

  // Handle messages from content scripts and sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Record scraper tab ID if message comes from the pending posts tab
    if (sender.tab && sender.tab.id && sender.tab.url && sender.tab.url.includes('pending_posts')) {
      scraperTabId = sender.tab.id
      
      // If scraper loads and auto-mod is enabled, trigger the next request automatically
      if (message.type === 'SCRAPER_CONNECTED') {
        if (autoModEnabled && !isChecking) {
          setTimeout(requestNextProfile, 1500)
        }
      }
    }

    if (message.type === 'TOGGLE_AUTOMOD') {
      autoModEnabled = message.enabled
      activeGroupId = message.groupId || ''
      saveState()
      
      if (autoModEnabled) {
        isChecking = false
        logToSidepanel(`Auto-Moderation enabled for Group: ${activeGroupId}`, 'success')
        
        // Notify or open the pending posts tab to start working automatically
        chrome.tabs.query({}, (tabs) => {
          const matchingTab = tabs.find(tab => tab.id && tab.url && tab.url.includes(`${activeGroupId}/pending_posts`))
          
          if (matchingTab && matchingTab.id) {
            logToSidepanel('Pending posts tab detected. Refreshing tab to inject and activate scraper...', 'info')
            chrome.tabs.reload(matchingTab.id)
          } else {
            const pendingPostsUrl = `https://www.facebook.com/groups/${activeGroupId}/pending_posts`
            logToSidepanel(`No open pending posts tab found. Opening: ${pendingPostsUrl}...`, 'info')
            chrome.tabs.create({ url: pendingPostsUrl, active: true })
          }
        })
      } else {
        logToSidepanel('Auto-Moderation disabled. Cleaning up...', 'warning')
        cleanupCurrentCheck()
        
        // Notify all tabs to stop scanning
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'TOGGLE_AUTOMOD',
                enabled: false,
                groupId: activeGroupId
              }).catch(() => {})
            }
          })
        })
      }
    }

    else if (message.type === 'REACHED_END') {
      logToSidepanel('Reached the absolute bottom of the pending list. Auto-Moderation completed successfully!', 'success')
      autoModEnabled = false
      saveState()
      cleanupCurrentCheck()
      
      // Notify all tabs to stop scanning
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'TOGGLE_AUTOMOD',
              enabled: false,
              groupId: activeGroupId
            }).catch(() => {})
          }
        })
      })
    }

    else if (message.type === 'PROCESS_PROFILE') {
      if (!autoModEnabled) return
      
      const { url, userName } = message.profile
      isChecking = true
      currentTask = { url, userName }
      
      logToSidepanel(`Checking profile: ${userName || 'Unknown'}...`, 'info')
      
      chrome.tabs.create({
        url: url,
        active: true // Open as active tab to ensure fast, prioritized content loading
      }, (tab) => {
        if (!tab || !tab.id) {
          logToSidepanel(`Failed to open profile tab for ${userName}`, 'error')
          cleanupCurrentCheck()
          if (autoModEnabled) {
            setTimeout(requestNextProfile, 1000)
          }
          return
        }

        currentTabId = tab.id

        // Setup fallback watchdog timeout (1 minute) in case check page hangs or fails to load
        checkTimeoutId = setTimeout(() => {
          if (isChecking && currentTabId === tab.id) {
            logToSidepanel(`Timeout checking profile for ${userName}. Force skipping...`, 'error')
            cleanupCurrentCheck()
            if (autoModEnabled) {
              setTimeout(requestNextProfile, 1000)
            }
          }
        }, 60000)
      })
    }

    else if (message.type === 'PROFILE_CHECK_RESULT') {
      const { url, status, userName, error } = message
      if (currentTask && getCleanUrl(currentTask.url) === getCleanUrl(url)) {
        clearTimeout(checkTimeoutId)
        
        if (status === 'skipped') {
          logToSidepanel(`Skipped ${userName || 'user'} (No existing approved posts found)`, 'info')
          updateStatsInSidepanel({ checked: 1, skipped: 1 })
          cleanupCurrentCheck()
          if (autoModEnabled) {
            setTimeout(requestNextProfile, 1500)
          }
        } else if (status === 'suspended') {
          logToSidepanel(`SUSPENDED ${userName || 'user'} successfully for 28 Days (Double-posting)`, 'success')
          updateStatsInSidepanel({ checked: 1, suspended: 1 })
          
          // Decline post for this user on the pending list tab
          if (scraperTabId !== null) {
            chrome.tabs.sendMessage(scraperTabId, { type: 'DECLINE_POST_FOR_USER', userName: userName }).catch(() => {})
          }
          
          cleanupCurrentCheck()
          // Wait slightly longer (e.g. 3s) so the decline button click is seen clearly before moving to the next profile
          if (autoModEnabled) {
            setTimeout(requestNextProfile, 3000)
          }
        } else if (status === 'error') {
          logToSidepanel(`Error checking profile ${userName}: ${error || 'Unknown error'}`, 'error')
          cleanupCurrentCheck()
          if (autoModEnabled) {
            setTimeout(requestNextProfile, 1500)
          }
        }
      }
    }
  })

  // Monitor tab closures to handle cases where tab is closed manually or crashes
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId) {
      logToSidepanel('Profile tab closed. Requesting next...', 'warning')
      cleanupCurrentCheck()
      if (autoModEnabled) {
        setTimeout(requestNextProfile, 1000)
      }
    } else if (tabId === scraperTabId) {
      logToSidepanel('Pending posts scraper tab was closed! Auto-Mod halted.', 'error')
      autoModEnabled = false
      saveState()
    }
  })
})

function cleanupCurrentCheck() {
  clearTimeout(checkTimeoutId)
  if (currentTabId !== null) {
    chrome.tabs.remove(currentTabId).catch(() => {})
  }
  currentTabId = null
  currentTask = null
  isChecking = false
}
