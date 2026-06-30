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
        declinePostForUser(message.userName, message.profileUrl)
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
        // No new profile on screen. Let's scroll down to load more.
        const previousHeight = document.body.scrollHeight
        const isAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 150

        if (isAtBottom && retryCount >= 4) {
          sendLog('Reached the absolute bottom of the pending posts list (no more posts loading). All posts checked!', 'success')
          chrome.runtime.sendMessage({ type: 'REACHED_END' }).catch(() => {})
          return
        }

        sendLog(`No new profile cards found on screen (Attempt ${retryCount + 1}/4). Scrolling to load more...`, 'info')
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        })

        // Wait 3 seconds for content to load and render, then retry
        setTimeout(() => {
          const currentHeight = document.body.scrollHeight
          const currentlyAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 150
          
          if (currentlyAtBottom && currentHeight === previousHeight && retryCount >= 4) {
            sendLog('Reached the absolute bottom of the pending list (no more posts loading). Completing...', 'success')
            chrome.runtime.sendMessage({ type: 'REACHED_END' }).catch(() => {})
            return
          }
          
          processNextSingleProfile(retryCount + 1)
        }, 3000)
      }
    }

    function declinePostForUser(userName: string, profileUrl?: string) {
      const cards = getPendingPostCards()
      let matches = []

      if (profileUrl) {
        const cleanTarget = getCleanProfileUrl(profileUrl)
        matches = cards.filter(c => getCleanProfileUrl(c.profileUrl) === cleanTarget)
      }

      // Fallback to name matching if no profileUrl match
      if (matches.length === 0) {
        matches = cards.filter(c => c.user.toLowerCase().includes(userName.toLowerCase()) || userName.toLowerCase().includes(c.user.toLowerCase()))
      }
      
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
        .filter(a => {
          const href = a.href
          const text = a.innerText.trim()
          if (!text) return false
          
          return href.includes('/user/') || 
                 href.includes('profile.php?id=') || 
                 href.includes('/people/')
        })
      
      const cards: Array<{ user: string; profileUrl: string; element: HTMLElement }> = []
      
      userLinks.forEach(a => {
        let parent = a.parentElement;
        while (parent && parent !== document.body) {
          const hasApprove = Array.from(parent.querySelectorAll('[role=button], button'))
            .some(btn => btn.innerText.includes('Approve'));
          if (hasApprove) {
            const cleanUrl = getCleanProfileUrl(a.href)
            // Deduplicate by parent element (ensuring we map the actual first author link to the card)
            if (!cards.some(c => c.element === parent)) {
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
