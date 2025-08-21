// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Get user data from Telegram Web App API
let userId = null;
let telegramUser = null;
let isAdmin = false;

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

const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString();
};

// API functions
const apiCall = async (endpoint, options = {}) => {
    try {
        const url = `${API_BASE}${endpoint}`;
        console.log('Making API call to:', url);
        
        const reqOptions = { method: 'GET', headers: { 'Content-Type': 'application/json' }, ...options };
        reqOptions.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (endpoint.startsWith('/api/admin/') && userId) {
            reqOptions.headers['x-admin-id'] = String(userId);
        }
        
        // Auto-attach user_id to admin POST-like calls
        if (endpoint.startsWith('/api/admin/') && reqOptions.method && reqOptions.method.toUpperCase() !== 'GET') {
            let bodyObj = {};
            if (reqOptions.body) {
                try { bodyObj = JSON.parse(reqOptions.body); } catch (_) { bodyObj = {}; }
            }
            if (!bodyObj.user_id && userId) bodyObj.user_id = String(userId);
            reqOptions.body = JSON.stringify(bodyObj);
        }

        const response = await fetch(url, reqOptions);

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

// Check admin status
const checkAdminStatus = async () => {
    try {
        const data = await apiCall(`/api/admin/check/${userId}`);
        isAdmin = data.isAdmin;
        
        if (!isAdmin) {
            document.body.innerHTML = '<div class="admin-container"><div class="error">Access denied. You are not an admin.</div></div>';
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error checking admin status:', error);
        document.body.innerHTML = '<div class="admin-container"><div class="error">Error checking admin status.</div></div>';
        return false;
    }
};

// Load dashboard data
const loadDashboard = async () => {
    try {
        const data = await apiCall('/api/admin/dashboard');
        
        document.getElementById('totalUsers').textContent = formatNumber(data.totalUsers);
        document.getElementById('activeUsers').textContent = formatNumber(data.activeUsers);
        document.getElementById('totalPoints').textContent = formatNumber(data.totalPoints);
        document.getElementById('pendingWithdrawals').textContent = formatNumber(data.pendingWithdrawals);
        
        // Load recent activity
        let activityHtml = '';
        if (data.recentActivity && data.recentActivity.length > 0) {
            data.recentActivity.forEach(activity => {
                activityHtml += `
                    <div style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-weight: 600; margin-bottom: 4px;">${activity.action}</div>
                        <div style="font-size: 12px; opacity: 0.8;">${formatDate(activity.timestamp)}</div>
                    </div>
                `;
            });
        } else {
            activityHtml = '<div style="text-align: center; opacity: 0.7;">No recent activity</div>';
        }
        
        document.getElementById('recentActivity').innerHTML = activityHtml;
    } catch (error) {
        console.error('Error loading dashboard:', error);
        const errBox = document.getElementById('dashboardErrors');
        if (errBox) errBox.innerHTML = showError('Failed to load dashboard');
    }
};

// Load configuration
const loadConfiguration = async () => {
    try {
        const data = await apiCall('/api/admin/config');
        
        // Fill form fields
        document.getElementById('channelJoinPoints').value = data.pointsConfig.channelJoinPoints;
        document.getElementById('groupJoinPoints').value = data.pointsConfig.groupJoinPoints;
        document.getElementById('friendInvitePoints').value = data.pointsConfig.friendInvitePoints;
        document.getElementById('dailyTaskLimit').value = data.pointsConfig.dailyTaskLimit;
        
        document.getElementById('minWithdrawal').value = data.withdrawalConfig.minWithdrawal;
        document.getElementById('maxWithdrawal').value = data.withdrawalConfig.maxWithdrawal;
        document.getElementById('withdrawalFee').value = data.withdrawalConfig.withdrawalFee;
        document.getElementById('bankEditFee').value = data.withdrawalConfig.bankEditFee;
        if (document.getElementById('currencySymbol')) document.getElementById('currencySymbol').value = data.withdrawalConfig.currencySymbol || '₦';
        if (document.getElementById('pointToCurrencyRate')) document.getElementById('pointToCurrencyRate').value = data.withdrawalConfig.pointToCurrencyRate || 1;
        const wdEnabled = document.getElementById('withdrawalsEnabled');
        if (wdEnabled) wdEnabled.checked = !!data.withdrawalConfig.withdrawalsEnabled;
        
        document.getElementById('dailyClaimsLimit').value = data.claimsConfig.dailyClaimsLimit;
        document.getElementById('minClaimAmount').value = data.claimsConfig.minClaimAmount;
        document.getElementById('maxClaimAmount').value = data.claimsConfig.maxClaimAmount;
        document.getElementById('bonusClaimsPerFriends').value = data.claimsConfig.bonusClaimsPerFriends;
        document.getElementById('friendsRequiredForBonus').value = data.claimsConfig.friendsRequiredForBonus;
        
        document.getElementById('supportUsername').value = data.supportConfig.supportUsername;
        // Fill support admins
        const sup = data.supportConfig.supportAdmins || [];
        const get = (i, k) => (sup[i] && sup[i][k]) || '';
        const ids = ['1','2','3','4','5'];
        ids.forEach((id, idx) => {
            const u = document.getElementById('supA' + id);
            const d = document.getElementById('supA' + id + 'D');
            if (u) u.value = get(idx, 'username');
            if (d) d.value = get(idx, 'description');
        });
        if (document.getElementById('appName')) document.getElementById('appName').value = (data.appConfig && data.appConfig.appName) || 'TGTask';
    } catch (error) {
        console.error('Error loading configuration:', error);
    }
};

// Load tasks
const loadTasks = async () => {
    try {
        const data = await apiCall('/api/admin/tasks');
        
        let tasksHtml = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Name</th>
                            <th>Username/ID</th>
                            <th>Points</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.channels && data.channels.length > 0) {
            data.channels.forEach(channel => {
                tasksHtml += `
                    <tr>
                        <td>📺 Channel</td>
                        <td>${channel.channel_name}</td>
                        <td>${channel.channel_username}</td>
                        <td>${channel.points_reward}</td>
                        <td><span class="status-badge ${channel.is_active ? 'status-active' : 'status-inactive'}">${channel.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                            <button class="btn btn-secondary" onclick="toggleChannelStatus(${channel.id})">
                                ${channel.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button class="btn btn-danger" onclick="deleteChannel(${channel.id})">Delete</button>
                        </td>
                    </tr>
                `;
            });
        }
        
        if (data.groups && data.groups.length > 0) {
            data.groups.forEach(group => {
                tasksHtml += `
                    <tr>
                        <td>👥 Group</td>
                        <td>${group.group_name}</td>
                        <td>${group.group_username}</td>
                        <td>${group.points_reward}</td>
                        <td><span class="status-badge ${group.is_active ? 'status-active' : 'status-inactive'}">${group.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                            <button class="btn btn-secondary" onclick="toggleGroupStatus(${group.id})">
                                ${group.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button class="btn btn-danger" onclick="deleteGroup(${group.id})">Delete</button>
                        </td>
                    </tr>
                `;
            });
        }
        
        if ((!data.channels || data.channels.length === 0) && (!data.groups || data.groups.length === 0)) {
            tasksHtml += '<tr><td colspan="6" style="text-align: center; opacity: 0.7;">No tasks available</td></tr>';
        }
        
        tasksHtml += `
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('currentTasks').innerHTML = tasksHtml;
    } catch (error) {
        document.getElementById('currentTasks').innerHTML = showError('Failed to load tasks');
    }
};

// Load users
const loadUsers = async () => {
    try {
        const q = document.getElementById('userSearchInput')?.value || '';
        const data = await apiCall(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
        
        let usersHtml = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Username</th>
                            <th>Telegram ID</th>
                            <th>Points</th>
                            <th>Friends</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.users && data.users.length > 0) {
            data.users.forEach(user => {
                usersHtml += `
                    <tr>
                        <td>${user.first_name || 'Unknown'}</td>
                        <td>@${user.username || 'N/A'}</td>
                        <td>
                            <span>${user.telegram_id}</span>
                            <button class="btn btn-secondary copy-id" data-id="${user.telegram_id}" style="padding:4px 8px; margin-left:6px;">Copy</button>
                        </td>
                        <td>${formatNumber(user.points)}</td>
                        <td>${user.friends_invited}</td>
                        <td>${formatDate(user.created_at)}</td>
                        <td>
                            <button class="btn btn-secondary view-user" data-id="${user.telegram_id}">View</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            usersHtml += '<tr><td colspan="6" style="text-align: center; opacity: 0.7;">No users found</td></tr>';
        }
        
        usersHtml += `
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('usersList').innerHTML = usersHtml;
    } catch (error) {
        document.getElementById('usersList').innerHTML = showError('Failed to load users');
    }
};

// Load withdrawals
const loadWithdrawals = async () => {
    try {
        const sel = document.getElementById('withdrawalsFilter');
        const status = sel ? sel.value : 'all';
        const data = await apiCall(`/api/admin/withdrawals?status=${encodeURIComponent(status)}`);
        
        let withdrawalsHtml = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Amount</th>
                            <th>Bank Details</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.withdrawals && data.withdrawals.length > 0) {
            data.withdrawals.forEach(withdrawal => {
                const statusClass = withdrawal.status === 'pending' ? 'status-pending' : 
                                  withdrawal.status === 'completed' ? 'status-active' : 'status-inactive';
                
                withdrawalsHtml += `
                    <tr>
                        <td>${withdrawal.user_name || 'Unknown'}</td>
                        <td>${formatNumber(withdrawal.amount)} pts</td>
                        <td style="white-space:normal; word-break:break-word;">${withdrawal.bank_details || 'N/A'}</td>
                        <td><span class="status-badge ${statusClass}">${withdrawal.status}</span></td>
                        <td>${formatDate(withdrawal.created_at)}</td>
                        <td>
                            ${withdrawal.status === 'pending' ? `
                                <button class="btn btn-primary approve-withdrawal" data-id="${withdrawal.id}">Approve</button>
                                <button class="btn btn-danger reject-withdrawal" data-id="${withdrawal.id}">Reject</button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            });
        } else {
            withdrawalsHtml += '<tr><td colspan="6" style="text-align: center; opacity: 0.7;">No withdrawals found</td></tr>';
        }
        
        withdrawalsHtml += `
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('withdrawalsList').innerHTML = withdrawalsHtml;
    } catch (error) {
        document.getElementById('withdrawalsList').innerHTML = showError('Failed to load withdrawals');
    }
};

// Load channels
const loadChannels = async () => {
    try {
        const data = await apiCall('/api/admin/channels');
        
        let channelsHtml = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Username/ID</th>
                            <th>Points</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.channels && data.channels.length > 0) {
            data.channels.forEach(channel => {
                channelsHtml += `
                    <tr>
                        <td>${channel.channel_name}</td>
                        <td>${channel.channel_username}</td>
                        <td>${channel.points_reward}</td>
                        <td><span class="status-badge ${channel.is_active ? 'status-active' : 'status-inactive'}">${channel.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                            <button class="btn btn-secondary toggle-channel" data-id="${channel.id}" data-active="${channel.is_active ? '1' : '0'}">
                                ${channel.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button class="btn btn-danger delete-channel" data-id="${channel.id}">Delete</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            channelsHtml += '<tr><td colspan="5" style="text-align: center; opacity: 0.7;">No channels found</td></tr>';
        }
        
        channelsHtml += `
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('channelsList').innerHTML = channelsHtml;
    } catch (error) {
        document.getElementById('channelsList').innerHTML = showError('Failed to load channels');
    }
};

// Load groups
const loadGroups = async () => {
    try {
        const data = await apiCall('/api/admin/groups');
        
        let groupsHtml = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Username/ID</th>
                            <th>Points</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.groups && data.groups.length > 0) {
            data.groups.forEach(group => {
                groupsHtml += `
                    <tr>
                        <td>${group.group_name}</td>
                        <td>${group.group_username}</td>
                        <td>${group.points_reward}</td>
                        <td><span class="status-badge ${group.is_active ? 'status-active' : 'status-inactive'}">${group.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                            <button class="btn btn-secondary toggle-group" data-id="${group.id}" data-active="${group.is_active ? '1' : '0'}">
                                ${group.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button class="btn btn-danger delete-group" data-id="${group.id}">Delete</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            groupsHtml += '<tr><td colspan="5" style="text-align: center; opacity: 0.7;">No groups found</td></tr>';
        }
        
        groupsHtml += `
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('groupsList').innerHTML = groupsHtml;
    } catch (error) {
        document.getElementById('groupsList').innerHTML = showError('Failed to load groups');
    }
};

// Tab switching
const switchTab = (tabName) => {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // Load tab-specific data
    switch (tabName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'config':
            loadConfiguration();
            break;
        case 'tasks':
            loadTasks();
            break;
        case 'users':
            loadUsers();
            break;
        case 'withdrawals':
            loadWithdrawals();
            break;
        case 'channels':
            loadChannels();
            break;
        case 'groups':
            loadGroups();
            break;
        case 'social':
            loadSocialTasks();
            break;
        case 'moderation':
            // no initial load
            break;
        case 'broadcast':
            // no initial load
            break;
        case 'onboarding':
            loadOnboarding();
            break;
        case 'refAudit':
            // no initial load
            break;
        case 'ledger':
            // no initial load
            break;
    }
};

// Form submissions
document.addEventListener('DOMContentLoaded', async () => {
    // Check admin status first
    const adminCheck = await checkAdminStatus();
    if (!adminCheck) return;
    
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });
    
    // Points configuration form
    document.getElementById('pointsConfigForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            channelJoinPoints: parseInt(document.getElementById('channelJoinPoints').value),
            groupJoinPoints: parseInt(document.getElementById('groupJoinPoints').value),
            friendInvitePoints: parseInt(document.getElementById('friendInvitePoints').value),
            dailyTaskLimit: parseInt(document.getElementById('dailyTaskLimit').value)
        };
        
        try {
            await apiCall('/api/admin/config/points', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            
            tg.showAlert('✅ Points configuration saved successfully!');
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Withdrawal configuration form
    document.getElementById('withdrawalConfigForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            minWithdrawal: parseInt(document.getElementById('minWithdrawal').value),
            maxWithdrawal: parseInt(document.getElementById('maxWithdrawal').value),
            withdrawalFee: parseFloat(document.getElementById('withdrawalFee').value),
            bankEditFee: parseInt(document.getElementById('bankEditFee').value),
            currencySymbol: (document.getElementById('currencySymbol')?.value || '₦'),
            pointToCurrencyRate: parseFloat(document.getElementById('pointToCurrencyRate')?.value || '1')
        };
        
        try {
            await apiCall('/api/admin/config/withdrawal', {
                method: 'POST',
                body: JSON.stringify({
                    ...formData,
                    withdrawalsEnabled: !!document.getElementById('withdrawalsEnabled')?.checked
                })
            });
            
            tg.showAlert('✅ Withdrawal configuration saved successfully!');
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Claims configuration form
    document.getElementById('claimsConfigForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            dailyClaimsLimit: parseInt(document.getElementById('dailyClaimsLimit').value),
            minClaimAmount: parseInt(document.getElementById('minClaimAmount').value),
            maxClaimAmount: parseInt(document.getElementById('maxClaimAmount').value),
            bonusClaimsPerFriends: parseInt(document.getElementById('bonusClaimsPerFriends').value),
            friendsRequiredForBonus: parseInt(document.getElementById('friendsRequiredForBonus').value)
        };
        
        try {
            await apiCall('/api/admin/config/claims', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            
            tg.showAlert('✅ Claims configuration saved successfully!');
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Support configuration form
    document.getElementById('supportConfigForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            supportUsername: document.getElementById('supportUsername').value
        };
        
        try {
            const admins = [1,2,3,4,5].map(n => ({
                username: document.getElementById('supA'+n)?.value || '',
                description: document.getElementById('supA'+n+'D')?.value || ''
            }));
            await apiCall('/api/admin/config/support', { method: 'POST', body: JSON.stringify({ ...formData, admins }) });
            
            tg.showAlert('✅ Support configuration saved successfully!');
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });

    // App configuration form
    const appForm = document.getElementById('appConfigForm');
    if (appForm) appForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = { appName: document.getElementById('appName').value };
        try {
            await apiCall('/api/admin/config/app', { method: 'POST', body: JSON.stringify(payload) });
            tg.showAlert('✅ App configuration saved successfully!');
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Add channel form
    document.getElementById('addChannelForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            channelName: document.getElementById('channelName').value,
            channelUsername: document.getElementById('channelUsername').value,
            pointsReward: parseInt(document.getElementById('channelPoints').value),
            description: document.getElementById('channelDescription').value
        };
        
        try {
            await apiCall('/api/admin/channels', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            
            tg.showAlert('✅ Channel added successfully!');
            document.getElementById('addChannelForm').reset();
            loadTasks();
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Add group form
    document.getElementById('addGroupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            groupName: document.getElementById('groupName').value,
            groupUsername: document.getElementById('groupUsername').value,
            pointsReward: parseInt(document.getElementById('groupPoints').value),
            description: document.getElementById('groupDescription').value
        };
        
        try {
            await apiCall('/api/admin/groups', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            
            tg.showAlert('✅ Group added successfully!');
            document.getElementById('addGroupForm').reset();
            loadTasks();
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
    
    // Add social task form
    const addSocialForm = document.getElementById('addSocialTaskForm');
    if (addSocialForm) {
        addSocialForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                platform: document.getElementById('socialPlatform').value,
                taskName: document.getElementById('socialTaskName').value,
                taskLink: document.getElementById('socialTaskLink').value,
                pointsReward: parseInt(document.getElementById('socialTaskPoints').value),
                description: document.getElementById('socialTaskDescription').value
            };
            try {
                await apiCall('/api/admin/social-tasks', { method: 'POST', body: JSON.stringify(formData) });
                tg.showAlert('✅ Social task added!');
                addSocialForm.reset();
                loadSocialTasks();
            } catch (err) {
                tg.showAlert('❌ ' + (err.message || 'Failed to add social task'));
            }
        });
    }

    // Initial tab
    // Load initial dashboard
    loadDashboard();
    // Bind search for users tab
    const search = document.getElementById('userSearchInput');
    if (search && !search._bound) {
        let t;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => loadUsers(), 250);
        });
        search._bound = true;
    }
    // Bind referral audit form
    const refAuditForm = document.getElementById('refAuditForm');
    if (refAuditForm) {
        refAuditForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const refTgId = document.getElementById('refAuditRefTgId').value.trim();
            if (!refTgId) { if (tg && tg.showAlert) tg.showAlert('Enter referrer Telegram ID'); else alert('Enter referrer Telegram ID'); return; }
            const btn = document.getElementById('refAuditRunBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Auditing...'; }
            try {
                const res = await apiCall('/api/admin/referral-audit', { method: 'POST', body: JSON.stringify({ referrerTelegramId: parseInt(refTgId, 10) }) });
                const sum = res.counts || { total: 0, members: 0, nonMembers: 0 };
                const pct = sum.total > 0 ? Math.round((sum.members / sum.total) * 100) : 0;
                const ref = res.referrer || {};
                document.getElementById('refAuditSummary').innerHTML = `Referrer: @${ref.username || 'N/A'} (${ref.telegram_id}) • Total: ${sum.total} • Members: ${sum.members} • Not Members: ${sum.nonMembers} • Active %: ${pct}%`;
                const body = document.getElementById('refAuditTableBody');
                const rows = [];
                const renderRow = (u, good) => `
                    <tr>
                        <td>${(u.first_name || '') + ' ' + (u.last_name || '')}</td>
                        <td>@${u.username || 'N/A'}</td>
                        <td>${u.telegram_id}</td>
                        <td>${formatDate(u.created_at)}</td>
                        <td><span class="status-badge ${u.channelOk ? 'status-active' : 'status-inactive'}">${u.channelOk ? 'Yes' : 'No'}</span></td>
                        <td><span class="status-badge ${u.groupOk ? 'status-active' : 'status-inactive'}">${u.groupOk ? 'Yes' : 'No'}</span></td>
                    </tr>`;
                (res.members || []).forEach(u => rows.push(renderRow(u, true)));
                (res.nonMembers || []).forEach(u => rows.push(renderRow(u, false)));
                body.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="6" style="text-align:center; opacity:0.7;">No data</td></tr>';
            } catch (err) {
                document.getElementById('refAuditSummary').innerHTML = showError(err.message || 'Audit failed');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Run Audit'; }
            }
        });
    }
    // Bind user ledger form
    const ledgerForm = document.getElementById('userLedgerForm');
    if (ledgerForm) {
        ledgerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tgId = document.getElementById('ledgerUserId').value.trim();
            if (!tgId) { if (tg && tg.showAlert) tg.showAlert('Enter user Telegram ID'); else alert('Enter user Telegram ID'); return; }
            const btn = document.getElementById('ledgerRunBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
            try {
                const res = await apiCall('/api/admin/user-ledger', { method: 'POST', body: JSON.stringify({ targetTelegramId: parseInt(tgId, 10) }) });
                const u = res.user || {};
                const sum = res.total_points_listed || 0;
                document.getElementById('ledgerSummary').innerHTML = `User: @${u.username || 'N/A'} (${u.telegram_id}) • Balance: ${u.points} • Total Earned (DB): ${u.total_points_earned} • Listed Sum: ${sum} • Entries: ${res.count || 0}`;
                const body = document.getElementById('ledgerTableBody');
                const rows = (res.ledger || []).map(r => `
                    <tr>
                        <td>${r.source}</td>
                        <td>${formatNumber(r.points)}</td>
                        <td>${formatDate(r.earned_at)}</td>
                    </tr>`);
                body.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3" style="text-align:center; opacity:0.7;">No data</td></tr>';
            } catch (err) {
                document.getElementById('ledgerSummary').innerHTML = showError(err.message || 'Failed to load ledger');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Run Ledger'; }
            }
        });
    }
});
async function loadOnboarding() {
    try {
        const data = await apiCall('/api/admin/onboarding-config');
        document.getElementById('requiredChannel').value = data.requiredChannel || '';
        document.getElementById('requiredGroup').value = data.requiredGroup || '';
        document.getElementById('onboardingWelcome').value = data.onboardingWelcome || '';
    } catch (_) {}
    const form = document.getElementById('onboardingConfigForm');
    if (form && !form._bound) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                requiredChannel: document.getElementById('requiredChannel').value,
                requiredGroup: document.getElementById('requiredGroup').value,
                onboardingWelcome: document.getElementById('onboardingWelcome').value
            };
            try {
                await apiCall('/api/admin/onboarding-config', { method: 'POST', body: JSON.stringify(payload) });
                if (tg && tg.showAlert) tg.showAlert('✅ Onboarding config saved'); else alert('Saved');
            } catch (err) { if (tg && tg.showAlert) tg.showAlert('❌ ' + err.message); else alert(err.message || 'Error'); }
        });
        form._bound = true;
    }
}

// Action functions (to be called from onclick handlers)
// Delegate clicks for Channels/Groups actions
document.addEventListener('click', async (e) => {
    const toggleChannel = e.target.closest('.toggle-channel');
    if (toggleChannel) {
        const id = toggleChannel.getAttribute('data-id');
        try {
            await apiCall(`/api/admin/channels/${id}/toggle`, { method: 'POST' });
            if (tg && tg.showAlert) tg.showAlert('✅ Channel status updated!'); else alert('Channel status updated');
            loadTasks();
            loadChannels();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
    const deleteChannelBtn = e.target.closest('.delete-channel');
    if (deleteChannelBtn) {
        const id = deleteChannelBtn.getAttribute('data-id');
        if (!confirm('Are you sure you want to delete this channel?')) return;
        try {
            await apiCall(`/api/admin/channels/${id}`, { method: 'DELETE' });
            if (tg && tg.showAlert) tg.showAlert('✅ Channel deleted!'); else alert('Channel deleted');
            loadTasks();
            loadChannels();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
    const toggleGroup = e.target.closest('.toggle-group');
    if (toggleGroup) {
        const id = toggleGroup.getAttribute('data-id');
        try {
            await apiCall(`/api/admin/groups/${id}/toggle`, { method: 'POST' });
            if (tg && tg.showAlert) tg.showAlert('✅ Group status updated!'); else alert('Group status updated');
            loadTasks();
            loadGroups();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
    const deleteGroupBtn = e.target.closest('.delete-group');
    if (deleteGroupBtn) {
        const id = deleteGroupBtn.getAttribute('data-id');
        if (!confirm('Are you sure you want to delete this group?')) return;
        try {
            await apiCall(`/api/admin/groups/${id}`, { method: 'DELETE' });
            if (tg && tg.showAlert) tg.showAlert('✅ Group deleted!'); else alert('Group deleted');
            loadTasks();
            loadGroups();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
    }
    const toggleSocial = e.target.closest('.toggle-social');
    if (toggleSocial) {
        const id = toggleSocial.getAttribute('data-id');
        try {
            await apiCall(`/api/admin/social-tasks/${id}/toggle`, { method: 'POST' });
            if (tg && tg.showAlert) tg.showAlert('✅ Task status updated!'); else alert('Task status updated');
            loadSocialTasks();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
    const deleteSocial = e.target.closest('.delete-social');
    if (deleteSocial) {
        const id = deleteSocial.getAttribute('data-id');
        if (!confirm('Delete this social task?')) return;
        try {
            await apiCall(`/api/admin/social-tasks/${id}`, { method: 'DELETE' });
            if (tg && tg.showAlert) tg.showAlert('✅ Task deleted!'); else alert('Task deleted');
            loadSocialTasks();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
});

// Delegate clicks for approve/reject to avoid inline handlers
document.addEventListener('click', async (e) => {
    const approve = e.target.closest('.approve-withdrawal');
    if (approve) {
        const id = approve.getAttribute('data-id');
        try {
            await apiCall(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
            if (tg && tg.showAlert) tg.showAlert('✅ Withdrawal approved!'); else alert('Withdrawal approved');
            loadWithdrawals();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
        return;
    }
    const reject = e.target.closest('.reject-withdrawal');
    if (reject) {
        const id = reject.getAttribute('data-id');
        try {
            await apiCall(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
            if (tg && tg.showAlert) tg.showAlert('✅ Withdrawal rejected!'); else alert('Withdrawal rejected');
            loadWithdrawals();
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message); else alert(error.message || 'Error');
        }
    }
});

// Delegate view user
document.addEventListener('click', async (e) => {
    const viewBtn = e.target.closest('.view-user');
    if (viewBtn) {
        const telegramId = viewBtn.getAttribute('data-id');
        try {
            const user = await apiCall(`/api/user/${telegramId}`);
            const lines = [
                `Name: ${user.first_name || ''} ${user.last_name || ''}`,
                `Username: @${user.username || 'N/A'}`,
                `Points: ${user.points}`,
                `Friends Invited: ${user.friends_invited}`,
                `Joined: ${new Date(user.created_at).toLocaleString()}`
            ];
            if (tg && tg.showAlert) tg.showAlert(lines.join('\n'));
            else alert(lines.join('\n'));
        } catch (err) {
            if (tg && tg.showAlert) tg.showAlert('❌ Failed to load user');
            else alert('Failed to load user');
        }
    }
    const copyIdBtn = e.target.closest('.copy-id');
    if (copyIdBtn) {
        const id = copyIdBtn.getAttribute('data-id');
        try {
            await navigator.clipboard.writeText(id);
            if (tg && tg.showAlert) tg.showAlert('✅ Copied ID: ' + id); else alert('Copied ID: ' + id);
        } catch (_) {
            alert(id);
        }
    }
});

// Moderation forms
document.addEventListener('DOMContentLoaded', () => {
    const adjForm = document.getElementById('adjustBalanceForm');
    if (adjForm) {
        adjForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                targetTelegramId: document.getElementById('adjUserId').value,
                amount: parseInt(document.getElementById('adjAmount').value),
                reason: document.getElementById('adjReason').value
            };
            try {
                await apiCall('/api/admin/users/adjust-balance', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                if (tg && tg.showAlert) tg.showAlert('✅ Balance adjusted'); else alert('Balance adjusted');
            } catch (err) { if (tg && tg.showAlert) tg.showAlert('❌ ' + err.message); else alert(err.message || 'Error'); }
        });
    }
    const banForm = document.getElementById('banUserForm');
    if (banForm) {
        banForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                targetTelegramId: document.getElementById('banUserId').value,
                ban: document.getElementById('banAction').value === 'ban'
            };
            try {
                await apiCall('/api/admin/users/ban', { method: 'POST', body: JSON.stringify(payload) });
                if (tg && tg.showAlert) tg.showAlert('✅ User updated'); else alert('User updated');
            } catch (err) { if (tg && tg.showAlert) tg.showAlert('❌ ' + err.message); else alert(err.message || 'Error'); }
        });
    }
    const bcForm = document.getElementById('broadcastForm');
    if (bcForm) {
        bcForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                scope: document.getElementById('bcScope').value,
                target: document.getElementById('bcTarget').value,
                message: document.getElementById('bcMessage').value
            };
            const file = document.getElementById('bcMediaFile').files[0];
            if (file) {
                const arrayBuf = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuf);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                payload.mediaBase64 = btoa(binary);
                payload.mediaMime = file.type || 'application/octet-stream';
            }
            try {
                const url = `${API_BASE}/api/admin/broadcast`;
                const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-id': String(userId || '') }, body: JSON.stringify(payload) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const res = await response.json();
                document.getElementById('bcResult').innerHTML = showSuccess(`Job queued. Sent: ${res.sent || 0}, Failed: ${res.failed || 0}`);
            } catch (err) {
                document.getElementById('bcResult').innerHTML = showError(err.message || 'Broadcast failed');
            }
        });
    }
    // Withdrawals filter change
    const withdrawFilter = document.getElementById('withdrawalsFilter');
    if (withdrawFilter && !withdrawFilter._bound) {
        withdrawFilter.addEventListener('change', () => {
            loadWithdrawals();
        });
        withdrawFilter._bound = true;
    }
});

// Load social tasks
async function loadSocialTasks() {
    try {
        const data = await apiCall('/api/admin/social-tasks');
        let html = `
            <div class="table-container table-scroll">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Platform</th>
                            <th>Name</th>
                            <th>Link</th>
                            <th>Points</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (data.tasks && data.tasks.length > 0) {
            data.tasks.forEach(t => {
                html += `
                    <tr>
                        <td>${t.platform}</td>
                        <td>${t.task_name}</td>
                        <td><a href="${t.task_link}" target="_blank" style="color:#fff; text-decoration:underline;">Open</a><br/><span style="opacity:0.75; font-size:12px;">${t.description || ''}</span></td>
                        <td>${t.points_reward}</td>
                        <td><span class="status-badge ${t.is_active ? 'status-active' : 'status-inactive'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                            <button class="btn btn-secondary toggle-social" data-id="${t.id}">${t.is_active ? 'Disable' : 'Enable'}</button>
                            <button class="btn btn-danger delete-social" data-id="${t.id}">Delete</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            html += '<tr><td colspan="6" style="text-align:center; opacity:0.7;">No social tasks</td></tr>';
        }
        html += `</tbody></table></div>`;
        const mount = document.getElementById('socialTasksList');
        if (mount) mount.innerHTML = html;
    } catch (err) {
        const mount = document.getElementById('socialTasksList');
        if (mount) mount.innerHTML = showError('Failed to load social tasks');
    }
}
