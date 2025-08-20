// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Get user data from Telegram Web App API
let userId = null;
let telegramUser = null;
let userData = null;
let currentPage = 'home';

// Check if we're in Telegram Web App
if (window.Telegram && window.Telegram.WebApp) {
    try {
        window.Telegram.WebApp.ready();
        telegramUser = window.Telegram.WebApp.initDataUnsafe?.user;
        if (telegramUser) {
            userId = telegramUser.id;
        }
    } catch (error) {
        console.error('Telegram Web App API error:', error);
    }
}

// Fallback to URL parameters if Telegram API not available
if (!userId) {
    const urlParams = new URLSearchParams(window.location.search);
    userId = urlParams.get('user_id');
}

if (!userId) {
    document.body.innerHTML = '<div class="app-container"><div class="error">User ID not found. Please open this app from Telegram.</div></div>';
}

// API base URL
const API_BASE = window.location.origin;

// Utility functions
const showError = (message) => {
    return `<div class="error">${message}</div>`;
};

const showSuccess = (message) => {
    return `<div class="success">${message}</div>`;
};

const formatNumber = (num) => {
    return num.toLocaleString();
};

const getRankClass = (rank) => {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return 'other';
};

// API functions
const apiCall = async (endpoint, options = {}) => {
    try {
        const url = `${API_BASE}${endpoint}`;
        console.log('Making API call to:', url);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Response error:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('API response data:', data);
        return data;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
};

// Load user data
const loadUserData = async () => {
    try {
        console.log('Loading user data for ID:', userId);
        const data = await apiCall(`/api/user/${userId}`);
        console.log('User data received:', data);
        userData = data;
        renderUserProfile();
        renderHomePage();
    } catch (error) {
        console.error('Error loading user data:', error);
        document.getElementById('userName').textContent = 'Error';
        document.getElementById('userUsername').textContent = 'Failed to load';
    }
};

// Render user profile
const renderUserProfile = () => {
    if (!userData) return;
    
    const { first_name, last_name, username } = userData;
    const fullName = `${first_name || ''} ${last_name || ''}`.trim() || 'User';
    const displayName = fullName.length > 20 ? fullName.substring(0, 20) + '...' : fullName;
    
    // Update profile picture - try to get from Telegram Web App first
    const profilePic = document.getElementById('profilePic');
    const profileInitial = document.getElementById('profileInitial');
    
    // Try to get photo from Telegram Web App
    let photoUrl = null;
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
        photoUrl = window.Telegram.WebApp.initDataUnsafe.user.photo_url;
    }
    
    if (photoUrl) {
        profilePic.innerHTML = `<img src="${photoUrl}" alt="Profile" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
        profileInitial.style.display = 'flex';
    } else {
        profilePic.innerHTML = `<span>${displayName.charAt(0).toUpperCase()}</span>`;
    }
    
    document.getElementById('userName').textContent = displayName;
    document.getElementById('userUsername').textContent = username ? `@${username}` : '';
    
    // Update profile balance
    document.getElementById('profileBalanceAmount').textContent = formatNumber(userData.points || 0);
};

// Render home page
const renderHomePage = () => {
    if (!userData) return;

    // Update balance card
    document.getElementById('balanceAmount').textContent = formatNumber(userData.points || 0);
    document.getElementById('totalFriends').textContent = formatNumber(userData.friends_invited || 0);
    document.getElementById('userRank').textContent = `#${userData.stats?.rank || 'N/A'}`;
    
    // Load leaderboard
    loadLeaderboard();
};

// Load leaderboard
const loadLeaderboard = async () => {
    try {
        const data = await apiCall('/api/leaderboard?limit=10');
        renderLeaderboard(data.leaderboard);
    } catch (error) {
        document.getElementById('leaderboardContent').innerHTML = showError('Failed to load leaderboard');
    }
};

// Render leaderboard
const renderLeaderboard = (leaderboard) => {
    let html = '';
    leaderboard.forEach((user, index) => {
        const rank = index + 1;
        const name = user.first_name || user.username || 'Anonymous';
        
        html += `
            <div class="leaderboard-item">
                <div class="rank ${getRankClass(rank)}">${rank}</div>
                <div class="player-info">
                    <div class="player-name">${name}</div>
                    <div class="player-stats">${user.friends_invited} friends invited</div>
                </div>
                <div class="player-points">${formatNumber(user.points)}</div>
            </div>
        `;
    });

    document.getElementById('leaderboardContent').innerHTML = html;
};

// Load tasks
const loadTasks = async (platform = 'telegram') => {
    try {
        const data = await apiCall(`/api/tasks/${userId}`);
        renderTasks(data, platform);
    } catch (error) {
        document.getElementById('tasksContent').innerHTML = showError('Failed to load tasks');
    }
};

// Render tasks with proper join links
const renderTasks = (tasks, platform = 'telegram') => {
    let html = '';
    
    if (platform === 'telegram') {
        // Channels
        if (tasks.channels && tasks.channels.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">📺 Join Channels</h3>';
            tasks.channels.forEach(channel => {
                const isCompleted = channel.is_joined || false;
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${channel.channel_name}</div>
                            <div class="task-points">+${channel.points_reward}</div>
                        </div>
                        <div class="task-description">Join this channel to earn ${channel.points_reward} points</div>
                        <div class="task-actions">
                            <a href="${channel.channel_link}" target="_blank" class="btn btn-secondary">
                                <i class="fas fa-external-link-alt"></i> Join Channel
                            </a>
                            <button class="btn btn-primary" onclick="claimChannelJoin(${channel.id})" ${isCompleted ? 'disabled' : ''}>
                                ${isCompleted ? '✅ Claimed' : '📺 Claim Reward'}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        // Groups
        if (tasks.groups && tasks.groups.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">👥 Join Groups</h3>';
            tasks.groups.forEach(group => {
                const isCompleted = group.is_joined || false;
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${group.group_name}</div>
                            <div class="task-points">+${group.points_reward}</div>
                        </div>
                        <div class="task-description">Join this group to earn ${group.points_reward} points</div>
                        <div class="task-actions">
                            <a href="${group.group_link}" target="_blank" class="btn btn-secondary">
                                <i class="fas fa-external-link-alt"></i> Join Group
                            </a>
                            <button class="btn btn-primary" onclick="claimGroupJoin(${group.id})" ${isCompleted ? 'disabled' : ''}>
                                ${isCompleted ? '✅ Claimed' : '👥 Claim Reward'}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        if (tasks.channels.length === 0 && tasks.groups.length === 0) {
            html += '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No tasks available</h3><p>Check back later for new tasks!</p></div>';
        }
    } else if (platform === 'whatsapp') {
        html = '<div class="empty-state"><i class="fab fa-whatsapp"></i><h3>WhatsApp Tasks</h3><p>Coming soon! WhatsApp tasks will be available here.</p></div>';
    } else if (platform === 'facebook') {
        html = '<div class="empty-state"><i class="fab fa-facebook"></i><h3>Facebook Tasks</h3><p>Coming soon! Facebook tasks will be available here.</p></div>';
    }

    document.getElementById('tasksContent').innerHTML = html;
};

// Load earn page data
const loadEarnPage = async () => {
    try {
        const data = await apiCall(`/api/earn-status/${userId}`);
        renderEarnPage(data);
    } catch (error) {
        document.getElementById('earnPage').innerHTML = showError('Failed to load earn data');
    }
};

// Render earn page
const renderEarnPage = (earnData) => {
    const { claimsRemaining, totalClaims, claimHistory } = earnData;
    
    document.getElementById('earnProgress').textContent = `${totalClaims - claimsRemaining}/${totalClaims}`;
    
    // Render claim history
    let historyHtml = '';
    if (claimHistory && claimHistory.length > 0) {
        claimHistory.forEach(claim => {
            const date = new Date(claim.claimed_at).toLocaleDateString();
            historyHtml += `
                <div class="history-item">
                    <div class="history-header">
                        <div class="history-title">Daily Reward</div>
                        <div class="history-amount">+${claim.points_earned}</div>
                    </div>
                    <div class="history-date">${date}</div>
                </div>
            `;
        });
    } else {
        historyHtml = '<div class="empty-state"><i class="fas fa-gift"></i><h3>No claims yet</h3><p>Start claiming your daily rewards!</p></div>';
    }
    
    document.getElementById('earnHistory').innerHTML = historyHtml;
};

// Load history
const loadHistory = async (type = 'withdrawals') => {
    try {
        const data = await apiCall(`/api/history/${userId}?type=${type}`);
        renderHistory(data, type);
    } catch (error) {
        document.getElementById('historyContent').innerHTML = showError('Failed to load history');
    }
};

// Render history
const renderHistory = (historyData, type) => {
    let html = '';
    
    if (type === 'withdrawals') {
        if (historyData.withdrawals && historyData.withdrawals.length > 0) {
            historyData.withdrawals.forEach(withdrawal => {
                const date = new Date(withdrawal.created_at).toLocaleDateString();
                const statusClass = withdrawal.status === 'pending' ? 'status-pending' : 
                                  withdrawal.status === 'completed' ? 'status-completed' : 'status-failed';
                
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">Withdrawal</div>
                            <div class="history-amount">-₦${withdrawal.amount}</div>
                        </div>
                        <div class="history-date">${date}</div>
                        <div class="history-status ${statusClass}">${withdrawal.status}</div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><i class="fas fa-money-bill-wave"></i><h3>No withdrawals</h3><p>You haven\'t made any withdrawals yet.</p></div>';
        }
    } else if (type === 'earnings') {
        if (historyData.earnings && historyData.earnings.length > 0) {
            historyData.earnings.forEach(earning => {
                const date = new Date(earning.earned_at).toLocaleDateString();
                
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">${earning.task_name || 'Task Reward'}</div>
                            <div class="history-amount">+${earning.points_earned}</div>
                        </div>
                        <div class="history-date">${date}</div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><i class="fas fa-coins"></i><h3>No earnings</h3><p>Complete tasks to start earning!</p></div>';
        }
    }
    
    document.getElementById('historyContent').innerHTML = html;
};

// Task completion functions
const claimChannelJoin = async (channelId) => {
    try {
        const response = await apiCall('/api/verify-channel-membership', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId, channelId })
        });

        if (response.success && response.isMember) {
            tg.showAlert(`✅ Successfully claimed ${response.pointsEarned} points!`);
            await loadUserData();
            loadTasks('telegram');
        } else {
            tg.showAlert(`❌ ${response.message || 'Failed to claim reward'}`);
        }
    } catch (error) {
        console.error('Error claiming channel join:', error);
        tg.showAlert('❌ ' + error.message);
    }
};

const claimGroupJoin = async (groupId) => {
    try {
        const response = await apiCall('/api/verify-group-membership', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId, groupId })
        });

        if (response.success && response.isMember) {
            tg.showAlert(`✅ Successfully claimed ${response.pointsEarned} points!`);
            await loadUserData();
            loadTasks('telegram');
        } else {
            tg.showAlert(`❌ ${response.message || 'Failed to claim reward'}`);
        }
    } catch (error) {
        console.error('Error claiming group join:', error);
        tg.showAlert('❌ ' + error.message);
    }
};

// Claim reward function
const claimReward = async () => {
    const claimBtn = document.getElementById('claimBtn');
    const claimSpinner = document.getElementById('claimSpinner');
    
    claimBtn.disabled = true;
    claimSpinner.style.display = 'block';
    
    try {
        const response = await apiCall('/api/claim-reward', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId })
        });

        if (response.success) {
            tg.showAlert(`🎉 Congratulations! You earned ${response.pointsEarned} points!`);
            await loadUserData();
            await loadEarnPage();
        }
    } catch (error) {
        tg.showAlert('❌ ' + error.message);
    } finally {
        claimBtn.disabled = false;
        claimSpinner.style.display = 'none';
    }
};

// Navigation functions
const showPage = (pageName) => {
    // Hide all pages
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    document.getElementById(pageName + 'Page').classList.add('active');
    
    // Update footer navigation
    document.querySelectorAll('.footer-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
    
    currentPage = pageName;
    
    // Load page-specific data
    switch (pageName) {
        case 'home':
            loadHomePage();
            break;
        case 'tasks':
            loadTasks();
            break;
        case 'earn':
            loadEarnPage();
            break;
        case 'history':
            loadHistory('withdrawals');
            break;
        case 'profile':
            loadProfileData();
            break;
    }
};

// Make functions globally accessible for onclick handlers
window.showWithdrawPage = () => {
    showPage('withdraw');
    loadWithdrawData();
};

window.showAdvertisePage = () => {
    showPage('advertise');
};

window.showBankPage = () => {
    showPage('bank');
    loadBankData();
};

window.showInvitePage = () => {
    showPage('invite');
    loadInviteData();
};

window.showTeamPage = () => {
    showPage('team');
    loadTeamData();
};

window.showAboutPage = () => {
    showPage('about');
};

window.showFaqPage = () => {
    showPage('faq');
};

window.contactAdmin = () => {
    const supportUsername = '@your_support_username'; // This should come from env
    const message = `Hi! I need help with my TGTask account.`;
    const url = `https://t.me/${supportUsername.replace('@', '')}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
};

window.copyReferralLink = async () => {
    try {
        const data = await apiCall(`/api/user/${userId}/referral`);
        const referralLink = data.referralLink;
        
        await navigator.clipboard.writeText(referralLink);
        
        // Show success message
        const btn = document.querySelector('[onclick="copyReferralLink()"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.background = 'linear-gradient(45deg, #4ecdc4, #44a08d)';
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy link:', error);
        tg.showAlert('❌ Failed to copy referral link');
    }
};

// Load profile data
const loadProfileData = () => {
    if (userData) {
        document.getElementById('profileBalanceAmount').textContent = formatNumber(userData.points || 0);
    }
};

// Load invite data
const loadInviteData = async () => {
    try {
        const data = await apiCall(`/api/user/${userId}/referral`);
        
        document.getElementById('referralLink').textContent = data.referralLink.substring(0, 30) + '...';
        document.getElementById('totalReferred').textContent = data.totalReferred || 0;
        document.getElementById('referralEarnings').textContent = `₦${formatNumber(data.referralEarnings || 0)}`;
    } catch (error) {
        console.error('Error loading invite data:', error);
    }
};

// Load team data
const loadTeamData = async () => {
    try {
        const data = await apiCall(`/api/user/${userId}/team`);
        let html = '';
        
        if (data.teamMembers && data.teamMembers.length > 0) {
            data.teamMembers.forEach(member => {
                const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'User';
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">${name}</div>
                            <div class="history-amount">+₦500</div>
                        </div>
                        <div class="history-date">Joined ${new Date(member.created_at).toLocaleDateString()}</div>
                        <div class="history-status status-completed">${member.tasks_completed || 0} tasks completed</div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><i class="fas fa-users"></i><h3>No team members yet</h3><p>Share your referral link to start building your team!</p></div>';
        }
        
        document.getElementById('teamContent').innerHTML = html;
    } catch (error) {
        document.getElementById('teamContent').innerHTML = showError('Failed to load team data');
    }
};



// Load withdraw data
const loadWithdrawData = async () => {
    try {
        const data = await apiCall(`/api/bank-details/${userId}`);
        document.getElementById('withdrawBalance').textContent = formatNumber(userData.points || 0);
        
        if (data.bank_details) {
            document.getElementById('bankAccount').value = `${data.bank_details.account_name} - ${data.bank_details.account_number} (${data.bank_details.bank_name})`;
        } else {
            document.getElementById('bankAccount').value = 'No bank details added';
        }
    } catch (error) {
        console.error('Error loading withdraw data:', error);
    }
};

// Load bank data
const loadBankData = async () => {
    try {
        const data = await apiCall(`/api/bank-details/${userId}`);
        
        if (data.bank_details) {
            document.getElementById('accountName').value = data.bank_details.account_name;
            document.getElementById('accountNumber').value = data.bank_details.account_number;
            document.getElementById('bankSelect').value = data.bank_details.bank_name.toLowerCase();
        }
    } catch (error) {
        console.error('Error loading bank data:', error);
    }
};

// Toggle FAQ
window.toggleFaq = (faqId) => {
    // Implementation for FAQ toggle
    console.log('Toggle FAQ:', faqId);
};

// Form submissions
document.addEventListener('DOMContentLoaded', () => {
    // Footer navigation
    document.querySelectorAll('.footer-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            showPage(page);
        });
    });

    // Task tabs
    document.querySelectorAll('.task-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const platform = tab.dataset.taskTab;
            
            // Update active tab
            document.querySelectorAll('.task-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Load tasks for platform
            loadTasks(platform);
        });
    });

    // History tabs
    document.querySelectorAll('.history-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const type = tab.dataset.historyTab;
            
            // Update active tab
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Load history for type
            loadHistory(type);
        });
    });

    // Withdraw form
    document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseInt(document.getElementById('withdrawAmount').value);
        const minWithdrawal = 1000; // Should come from env
        
        if (amount < minWithdrawal) {
            tg.showAlert(`❌ Minimum withdrawal amount is ₦${minWithdrawal}`);
            return;
        }
        
        if (amount > (userData?.points || 0)) {
            tg.showAlert('❌ Insufficient balance');
            return;
        }
        
        try {
            const response = await apiCall('/api/withdraw', {
                method: 'POST',
                body: JSON.stringify({ telegramId: userId, amount })
            });

            if (response.success) {
                tg.showAlert('✅ Withdrawal request submitted successfully!');
                showPage('home');
                await loadUserData();
            }
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });

    // Bank form
    document.getElementById('bankForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const accountName = document.getElementById('accountName').value;
        const accountNumber = document.getElementById('accountNumber').value;
        const bankCode = document.getElementById('bankSelect').value;
        
        if (!accountName || !accountNumber || !bankCode) {
            tg.showAlert('❌ Please fill all fields');
            return;
        }
        
        try {
            const response = await apiCall('/api/bank-details', {
                method: 'POST',
                body: JSON.stringify({ 
                    telegramId: userId, 
                    accountName, 
                    accountNumber, 
                    bankCode 
                })
            });

            if (response.success) {
                tg.showAlert('✅ Bank details saved successfully!');
                showPage('home');
            }
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });

    // Initialize
    loadUserData();
});
