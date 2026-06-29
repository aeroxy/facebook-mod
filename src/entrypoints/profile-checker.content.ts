export default defineContentScript({
  matches: ['*://*.facebook.com/groups/*/user/*'],
  runAt: 'document_end',
  async main() {
    console.log('[Facebook Mod] Profile checker content script loaded')

    function sendLog(text: string, logType: 'info' | 'success' | 'warning' | 'error' = 'info') {
      chrome.runtime.sendMessage({
        type: 'ADD_LOG',
        text,
        logType
      }).catch(() => {})
    }

    // 1. Check if auto mod is enabled globally
    const state = await chrome.storage.local.get(['autoModEnabled'])
    if (!state.autoModEnabled) {
      console.log('[Facebook Mod] Auto-moderation is disabled. Skipping profile check.')
      return
    }

    const userName = getUserName()
    sendLog(`Inspecting user profile: ${userName}...`, 'info')

    try {
      // 2. Wait up to 6 seconds for group posts section to load
      sendLog(`Retrieving group post history for ${userName}...`, 'info')
      await waitForElement(() => document.body.innerText.includes('Group posts') || document.body.innerText.includes('No new posts'), 6000)

      // 3. Double-post detection check
      if (hasNoGroupPosts()) {
        sendLog(`No existing posts found for ${userName}. Skipping...`, 'info')
        chrome.runtime.sendMessage({
          type: 'PROFILE_CHECK_RESULT',
          url: window.location.href,
          status: 'skipped',
          userName
        })
        return
      }

      sendLog(`Double-posting detected for ${userName}! Starting auto-suspension sequence...`, 'warning')

      // 4. Open "More" Settings Dropdown
      sendLog('Opening Profile settings menu...', 'info')
      const moreBtn = await waitForElement(() => document.querySelector("[aria-label='Profile settings see more options']"), 4000)
      if (!moreBtn) throw new Error('More settings button not found')
      moreBtn.click()

      // 5. Select "Suspend" option in dropdown (and check for already suspended edge case)
      await delay(800)
      sendLog('Checking settings options...', 'info')

      const allText = Array.from(document.querySelectorAll('*')).map(el => (el as HTMLElement).innerText)
      const isAlreadySuspended = allText.some(t => t === 'Unsuspend')

      if (isAlreadySuspended) {
        sendLog(`${userName} is already suspended. Skipping...`, 'info')
        chrome.runtime.sendMessage({
          type: 'PROFILE_CHECK_RESULT',
          url: window.location.href,
          status: 'skipped',
          userName
        })
        return
      }

      sendLog('Selecting Suspend member option...', 'info')
      const suspendOption = await waitForElement(() => {
        const item = Array.from(document.querySelectorAll('*'))
          .find(el => el.innerText === 'Suspend')
        if (item) {
          // Find clickable container
          let parent = item as HTMLElement
          while (parent && parent !== document.body) {
            if (parent.tagName === 'DIV' && parent.className.includes('x1i10hfl')) {
              return parent
            }
            parent = parent.parentElement as HTMLElement
          }
          return item as HTMLElement
        }
        return null
      }, 4000)

      if (!suspendOption) throw new Error('Suspend option in dropdown not found')
      suspendOption.click()

      // 6. Select "28 Days" inside the Suspend Modal
      await delay(1000)
      sendLog('Setting duration to 28 Days...', 'info')
      const durationLabel = await waitForElement(() => 
        Array.from(document.querySelectorAll('label'))
          .find(el => el.innerText.trim() === '28 Days'),
        4000
      )
      if (!durationLabel) throw new Error('28 Days duration label not found')
      durationLabel.click()

      await delay(300)

      // 7. Click intermediate "Suspend" button inside modal
      sendLog('Submitting duration and opening violation rules...', 'info')
      const intermediateSuspendBtn = await waitForElement(() => 
        Array.from(document.querySelectorAll("[role='dialog'] div[role='button'], [role='dialog'] button"))
          .find(el => el.innerText.trim() === 'Suspend'),
        4000
      )
      if (!intermediateSuspendBtn) throw new Error('Intermediate Suspend button not found')
      intermediateSuspendBtn.click()

      // 8. Select "One post only" in Optional Details Modal
      await delay(1000)
      sendLog('Selecting "One post only" violation rule...', 'info')
      const ruleCheckbox = await waitForElement(() => {
        const textEl = Array.from(document.querySelectorAll('*'))
          .find(el => el.innerText?.trim() === 'One post only')
        if (textEl) {
          let parent = textEl as HTMLElement
          while (parent && parent !== document.body) {
            const cb = parent.querySelector('[role=checkbox]')
            if (cb) return cb as HTMLElement
            parent = parent.parentElement as HTMLElement
          }
        }
        return null
      }, 4000)

      if (!ruleCheckbox) throw new Error('One post only rule checkbox not found')
      ruleCheckbox.click()

      await delay(400)

      // 9. Click "Done" button to complete suspension
      sendLog('Confirming suspension...', 'success')
      const doneBtn = await waitForElement(() => 
        Array.from(document.querySelectorAll("[role='dialog'] div[role='button'], [role='dialog'] button"))
          .find(el => el.innerText.trim() === 'Done'),
        4000
      )
      if (!doneBtn) throw new Error('Done button not found')
      
      // EXTREMELY IMPORTANT: This triggers the actual moderation action.
      doneBtn.click()

      await delay(1500)

      // 10. Report completion to background script
      chrome.runtime.sendMessage({
        type: 'PROFILE_CHECK_RESULT',
        url: window.location.href,
        status: 'suspended',
        userName
      })

    } catch (e: any) {
      sendLog(`Error checking/suspending ${userName}: ${e.message}`, 'error')
      chrome.runtime.sendMessage({
        type: 'PROFILE_CHECK_RESULT',
        url: window.location.href,
        status: 'error',
        userName,
        error: e.message
      })
    }
  }
})

function getUserName(): string {
  try {
    // Standard Facebook page title format: "Vivian Zen Li | Facebook" or "(20) Vivian Zen Li | Facebook"
    const title = document.title
    const parts = title.split('|')
    let name = parts[0].trim()
    
    // Strip notification prefix like "(20+) " or "(2) "
    name = name.replace(/^\(\d+\+?\)\s*/, '')
    return name || 'Unknown User'
  } catch {
    return 'Unknown User'
  }
}

function hasNoGroupPosts(): boolean {
  const pageText = document.body.innerText

  // Rule 1: Explicit negative check
  const noPostsIndicators = [
    "hasn't posted anything yet",
    "has not posted anything yet",
    "No new posts",
    "没有发布过任何内容",
    "没有新发帖"
  ]
  
  for (const indicator of noPostsIndicators) {
    if (pageText.includes(indicator)) {
      return true
    }
  }

  // Rule 2: Explicit positive check
  const hasGroupPostHeader = pageText.includes("posted to 湾区租房 Bay Area Housing") || 
                             pageText.includes("分享了帖子") || 
                             pageText.includes("發佈於") ||
                             pageText.includes("posted to")
                             
  if (hasGroupPostHeader) {
    return false
  }

  // Rule 3: Fallback structural link checks
  const hasPostLinks = Array.from(document.querySelectorAll('a')).some(a => {
    const href = a.href
    return (href.includes('bayareahouse') || href.includes('500939864138258')) && 
           (href.includes('/posts/') || href.includes('/permalink/') || href.includes('post_insights/'))
  })

  if (hasPostLinks) {
    return false
  }

  return true
}

// Utility: Wait for an element to appear using a getter function
function waitForElement<T>(getter: () => T, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const el = getter()
    if (el) return resolve(el)

    const startTime = Date.now()
    const interval = setInterval(() => {
      const element = getter()
      if (element) {
        clearInterval(interval)
        resolve(element)
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval)
        reject(new Error(`Timeout waiting for element after ${timeout}ms`))
      }
    }, 150)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
