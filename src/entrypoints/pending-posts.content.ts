export default defineContentScript({
  matches: ['*://*.facebook.com/groups/*/pending_posts*'],
  runAt: 'document_end',
  main() {
    console.log('[Facebook Mod] Pending posts content script loaded')

    let autoModEnabled = false
    let activeGroupId = ''
    const processedProfiles = new Set<string>()

    function sendLog(text: string, logType: 'info' | 'success' | 'warning' | 'error' = 'info') {
      chrome.runtime.sendMessage({
        type: 'ADD_LOG',
        text,
        logType
      }).catch(() => {})
    }

    // Load initial state
    chrome.storage.local.get(['autoModEnabled', 'activeGroupId'], (result) => {
      autoModEnabled = !!result.autoModEnabled
      activeGroupId = result.activeGroupId || ''
      sendLog(`Pending posts page connected. (Auto-Mod: ${autoModEnabled ? 'Enabled' : 'Disabled'})`, 'info')
      
      // Let background know we are ready
      chrome.runtime.sendMessage({ type: 'SCRAPER_CONNECTED' }).catch(() => {})
    })

    // Listen for controls from sidepanel/background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'REQUEST_NEXT_PROFILE') {
        if (!autoModEnabled) return
        processNextSingleProfile()
      } else if (message.type === 'DECLINE_POST_FOR_USER') {
        if (!autoModEnabled) return
        declinePostForUser(message.userName)
      } else if (message.type === 'TOGGLE_AUTOMOD') {
        autoModEnabled = message.enabled
        activeGroupId = message.groupId || ''
        if (!autoModEnabled) {
          sendLog('Scanner paused.', 'warning')
        }
      }
    })

    async function processNextSingleProfile(retryCount = 0) {
      if (!autoModEnabled) return

      const cards = getPendingPostCards()
      
      // Find the first un-processed profile card on screen
      const nextCard = cards.find(card => {
        const cleanUrl = getCleanProfileUrl(card.profileUrl)
        return !processedProfiles.has(cleanUrl)
      })

      if (nextCard) {
        const cleanUrl = getCleanProfileUrl(nextCard.profileUrl)
        processedProfiles.add(cleanUrl)
        
        sendLog(`Processing user: ${nextCard.user}`, 'info')
        
        chrome.runtime.sendMessage({
          type: 'PROCESS_PROFILE',
          profile: {
            url: nextCard.profileUrl,
            userName: nextCard.user
          }
        }).catch(() => {})
      } else {
        const previousHeight = document.body.scrollHeight
        const isCurrentlyAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100

        if (isCurrentlyAtBottom && retryCount >= 1) {
          sendLog('Reached the absolute bottom of the pending posts list. All posts checked!', 'success')
          chrome.runtime.sendMessage({ type: 'REACHED_END' }).catch(() => {})
          return
        }

        // No new profile on screen, scroll and retry
        if (retryCount < 5) {
          sendLog('No new profile cards found on screen. Scrolling to load more...', 'info')
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
          })
          
          // Wait 2.5 seconds for new content to load, then retry
          setTimeout(() => {
            const isStillAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100
            if (isStillAtBottom && document.body.scrollHeight === previousHeight) {
              sendLog('Reached the absolute bottom of the pending list (no more posts loading). Completing...', 'success')
              chrome.runtime.sendMessage({ type: 'REACHED_END' }).catch(() => {})
              return
            }
            processNextSingleProfile(retryCount + 1)
          }, 2500)
        } else {
          sendLog('Reached scroll timeout or end of list.', 'warning')
          chrome.runtime.sendMessage({ type: 'REACHED_END' }).catch(() => {})
        }
      }
    }

    function declinePostForUser(userName: string) {
      const cards = getPendingPostCards()
      const matches = cards.filter(c => c.user.toLowerCase().includes(userName.toLowerCase()) || userName.toLowerCase().includes(c.user.toLowerCase()))
      
      if (matches.length > 0) {
        matches.forEach(match => {
          // Find the interactive clickable container (div.x1i10hfl) containing 'Decline' exactly
          const declineBtn = Array.from(match.element.querySelectorAll('div.x1i10hfl'))
            .find(btn => (btn as HTMLElement).innerText.trim() === 'Decline') as HTMLElement ||
            // Fallback to any element containing 'Decline' exactly
            Array.from(match.element.querySelectorAll('*'))
              .find(btn => (btn as HTMLElement).innerText.trim() === 'Decline') as HTMLElement
          
          if (declineBtn) {
            declineBtn.scrollIntoView({ block: 'center', behavior: 'smooth' })
            declineBtn.click()
            sendLog(`Declined pending post of suspended user: ${match.user}`, 'warning')
          } else {
            sendLog(`Found card for ${userName}, but Decline button was not found`, 'error')
          }
        })
      } else {
        sendLog(`Could not find pending card on screen to Decline for user: ${userName}`, 'warning')
      }
    }

    function getPendingPostCards() {
      const userLinks = Array.from(document.querySelectorAll('a'))
        .filter(a => a.href.includes('/user/') && a.innerText.trim());
      
      const cards: Array<{ user: string; profileUrl: string; element: HTMLElement }> = []
      
      userLinks.forEach(a => {
        let parent = a.parentElement;
        while (parent && parent !== document.body) {
          const hasApprove = Array.from(parent.querySelectorAll('[role=button], button'))
            .some(btn => btn.innerText.includes('Approve'));
          if (hasApprove) {
            const cleanUrl = getCleanProfileUrl(a.href)
            if (!cards.some(c => getCleanProfileUrl(c.profileUrl) === cleanUrl)) {
              cards.push({
                user: a.innerText.trim(),
                profileUrl: a.href,
                element: parent as HTMLElement
              })
            }
            break
          }
          parent = parent.parentElement
        }
      })
      
      return cards
    }

    function getCleanProfileUrl(url: string): string {
      try {
        const u = new URL(url)
        return u.origin + u.pathname
      } catch {
        return url
      }
    }
  }
})
