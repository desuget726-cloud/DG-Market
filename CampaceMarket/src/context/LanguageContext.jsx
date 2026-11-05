import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const LANGUAGE_STORAGE_KEY = 'campaceLanguage';
const GOOGLE_TRANSLATE_SCRIPT_ID = 'google-translate-script';

function getSavedLanguage() {
    try {
        return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'am' ? 'am' : 'en';
    } catch {
        return 'en';
    }
}

function applyGoogleLanguage(language, attempts = 30) {
    const dropdown = document.querySelector('.goog-te-combo');
    if (dropdown) {
        dropdown.value = language;
        dropdown.dispatchEvent(new Event('change'));
        return;
    }

    if (attempts > 0) {
        window.setTimeout(() => applyGoogleLanguage(language, attempts - 1), 200);
    }
}

// eslint-disable-next-line react-refresh/only-export-components
export const translations = {
    en: {
        home: {
            searchPlaceholderMobile: 'Search products…',
            searchPlaceholderFull: 'Search books, laptops, lab coats...',
            search: 'Search',
            searchMaterials: 'Search Materials',
            clearSearch: 'Clear search',
            browseDirectory: 'Browse Directory',
            allProducts: 'All Products',
            resultsFor: 'Results for “{query}”',
            itemsFound: '{count} items found',
            noProductsFound: 'No products found for “{query}”',
            noProductsAvailable: 'No products found.',
            listingsFailure: "We couldn't load listings right now. Please try again.",
            listingsLoading: 'Loading, please wait a moment…',
            noConnection: 'No connection. Check your internet and try again.',
            tryAgain: 'Try again',
            dismiss: 'Dismiss',
            developmentHint: 'Development mode: check the backend service.'
        },
        navbar: {
            language: 'Language',
            english: 'English',
            login: 'Login',
            signup: 'Signup'
        },
        walletPayout: {
            accountLabel: 'Payout account:',
            providerFallback: 'Configured provider',
            accountLoading: 'Loading payout account…',
            accountRequired: 'Set up a payout account to withdraw.',
            setupButton: 'Set up payout account',
            setupTitle: 'Set up your payout account',
            method: 'Payout method',
            bank: 'Bank',
            mobileMoney: 'Mobile money',
            mobileProvider: 'Mobile money provider',
            chooseProvider: 'Choose a provider',
            loadingBanks: 'Loading providers…',
            retryProviders: 'Retry loading providers',
            noProviders: 'No supported providers are available for this method.',
            holderName: 'Account holder name',
            holderNameInvalid: 'Confirm that the different payout account name belongs to you or an authorized family member.',
            alternativeNameConsent: 'The name on this bank account differs from your profile name. Please confirm this account belongs to you or an authorized family member.',
            mobileNumber: 'Mobile money number',
            accountNumber: 'Account number',
            mobileNumberInvalid: 'Enter a valid Ethiopian mobile number (09XXXXXXXX or 07XXXXXXXX).',
            accountNumberInvalid: 'Enter a valid account number for this bank (10–15 digits).',
            setupFieldsRequired: 'Choose a provider and enter the account holder name and number.',
            setupLoadError: 'Unable to load supported payout providers.',
            setupFailed: 'The payout account was not confirmed. Please try again.',
            authRequired: 'Please sign in again to set up a payout account.',
            verifiedRequired: 'Only verified students can set up a payout account.',
            changeAccount: 'Change payout account',
            saving: 'Saving…',
            saveAndContinue: 'Save and continue withdrawal',
            cancel: 'Cancel',
            processing: 'Processing…',
            submitWithdrawal: 'Submit withdrawal'
        },
        messages: {
            blockUser: 'Block User',
            unblockUser: 'Unblock User',
            confirmBlock: 'Block this user? You can unblock them later.',
            conversationBlocked: "You can't send messages in this conversation.",
            messagingDisabled: 'Messaging disabled',
            typeMessage: 'Type a message...'
        },
        sellerHub: {
            productManagement: 'Product Management',
            backToOverview: 'Back to Overview',
            inventoryTotal: 'total',
            inventoryActive: 'Active',
            inventorySold: 'Sold',
            inventoryPending: 'Pending',
            productsLoading: 'Loading products',
            productsLoadError: "We couldn't load your products. Please try again.",
            retryProducts: 'Retry',
            productsPagination: 'Product pages',
            productsPreviousPage: 'Previous page',
            productsNextPage: 'Next page',
            productsPage: 'Page {page}',
            productsShowing: 'Showing {start}-{end} of {total}',
            salesAnalytics: 'Sales Analytics',
            salesPerformance: 'Sales Performance',
            salesRange7d: '7 Days',
            salesRange30d: '30 Days',
            salesRange3m: '3 Months',
            salesRangeTotals: 'Revenue: {revenue} · Orders: {orders}',
            salesRevenueTrend: 'Sales revenue trend',
            salesLoading: 'Loading sales…',
            salesNoSales: 'No sales in this period',
            salesLoadError: "We couldn't load sales analytics. Please try again.",
            salesRetry: 'Retry'
        },
        sellerOrders: {
            history: 'Order History',
            completedOrders: 'Completed Orders',
            orderCount: '{count} orders',
            search: 'Search',
            searchPlaceholder: 'Product or customer name',
            dateFrom: 'Completed from',
            dateTo: 'Completed to',
            loading: 'Loading completed orders',
            retry: 'Retry',
            noCompletedOrders: 'No completed orders yet.',
            noMatchingOrders: 'No orders match these filters.',
            order: 'Order',
            customer: 'Customer',
            product: 'Product',
            amount: 'Amount',
            status: 'Status',
            completed: 'Completed',
            actions: 'Actions',
            openOrder: 'View completed order',
            sold: 'Sold',
            view: 'View',
            pageOf: 'Page {page} of {pages}',
            previous: 'Previous',
            next: 'Next',
            detailsTitle: 'Order details',
            backToOrders: 'Back to orders',
            productDetails: 'Product',
            description: 'Description',
            category: 'Category',
            quantity: 'Quantity',
            unitPrice: 'Unit price',
            payment: 'Payment',
            itemPrice: 'Item price',
            fees: 'Fees',
            totalReceived: 'Total received',
            paymentStatus: 'Payment status',
            paymentTime: 'Payment time',
            buyer: 'Buyer',
            department: 'Department',
            verifiedStudent: 'Verified student',
            timeline: 'Timeline',
            orderCreated: 'Order created',
            paymentCompleted: 'Payment completed',
            orderCompleted: 'Order completed',
            openChat: 'Open chat',
            dispute: 'Dispute',
            noIssues: 'No issues reported.',
            reportWindowTime: 'Time left to report a problem',
            reportWindowClosed: 'The problem-report window has closed.',
            responseRemaining: 'Seller response time remaining',
            respond: 'Respond',
            responseText: 'Your response',
            responsePlaceholder: 'Describe your response to the buyer’s report',
            evidence: 'Evidence',
            submitResponse: 'Submit response',
            cancel: 'Cancel',
            retryDetails: 'Retry loading details',
            unavailable: 'Not available'
        },
        adminReports: {
            title: 'Report Resolution',
            close: 'Close',
            notSpecified: 'Not specified',
            notRecorded: 'Not recorded',
            years: 'years',
            months: 'months',
            days: 'days',
            reporter: 'Reporter',
            studentId: 'Student ID',
            reportCount: 'Past report count',
            verified: 'Verified Student',
            yes: 'Yes',
            no: 'No',
            accountAge: 'Account age',
            reportedSeller: 'Reported seller',
            complaints: 'Complaint count',
            rating: 'Ratings',
            noRatings: 'No ratings',
            walletStatus: 'Order wallet status',
            product: 'Product',
            order: 'Order',
            paidAmount: 'Paid amount',
            complaintType: 'Complaint type',
            status: 'Status',
            reviewedBy: 'Reviewed by',
            issueDetails: 'Issue details',
            sellerResponse: 'Seller response',
            sellerResponsePhoto: 'Seller response evidence',
            appeal: 'Appeal',
            loadingContext: 'Loading report context…',
            viewEvidence: 'View evidence photo',
            loadingLogs: 'Loading conversation…',
            viewConversation: 'View conversation logs',
            resolvedDecision: 'Decision',
            decision: 'Admin decision',
            selectDecision: 'Select decision',
            warning: 'Warning',
            removeProduct: 'Remove Product',
            suspendUser: 'Suspend User',
            refund: 'Refund',
            reject: 'Reject',
            refundOrder: 'Refund order',
            refundAmount: 'Refund amount (ETB)',
            refundAmountError: 'Enter an amount greater than zero and no more than the amount paid.',
            refundRequiresOrder: 'Refund is only available for reports linked to a paid order.',
            confirmEffect: 'Confirm this action and its effect:',
            takeOverConfirm: 'Take over review of this report?',
            resolveError: 'Failed to resolve the report.',
            reviewError: 'Failed to open the report for review.',
            contextError: 'Unable to load report context.',
            openingReview: 'Opening report for review…',
            reason: 'Written reason (required)',
            reasonPlaceholder: 'Explain the decision and its basis.',
            reasonMinLength: 'Minimum 10 characters',
            resolving: 'Resolving…',
            resolve: 'Resolve',
            resolved: 'Report resolved successfully.'
        },
        sellerReportInbox: {
            title: 'Reports',
            authRequired: 'Sign in again to load report actions.',
            loadError: 'Unable to load report actions.',
            submitError: 'Unable to submit your report response.',
            report: 'Report',
            responseSubmitted: 'Response submitted',
            decision: 'Decision',
            response: 'Your one-time response (available within 48 hours)',
            photo: 'Attach an optional photo',
            submitting: 'Submitting…',
            submitResponse: 'Submit response',
            appeal: 'One-time appeal',
            submitAppeal: 'Submit appeal'
        },
        productDetails: {
            loginRequired: 'Login required',
            loginPrompt: 'Log in to continue',
            login: 'Login',
            cancel: 'Cancel',
            buyer: {
                handover: 'Handover location',
                availableHours: 'Available hours',
                posted: 'Posted',
                recently: 'recently',
                peopleViewed: 'people viewed this listing',
                sellerRating: 'Seller rating',
                reviews: 'reviews',
                noSellerReviews: 'No ratings yet',
                itemsSold: 'Items sold',
                memberSince: 'Member since',
                responseTime: 'Typical response time',
                responseUnderHour: 'Under 1 hour',
                responseWithinFewHours: 'Within a few hours',
                responseWithinDay: 'Within a day',
                responseWithinFewDays: 'Within a few days',
                responseHours: 'hours',
                responseUnavailable: 'Not available yet',
                moreFromSeller: 'More from this seller',
                similarProducts: 'Similar Products',
                similarProductsError: 'We could not load similar products.',
                similarProductsRetry: 'Retry',
                soldOut: 'Sold out',
                category: 'Category',
                howBuyingWorks: 'How buying works',
                protectionNote: 'Pay only after inspecting the item.',
                sendMessage: 'Send Message',
                steps: {
                    chat: 'Chat: Agree on availability, price, and meeting place and time.',
                    checkItem: 'Check the item: Make sure it matches the photos and description.',
                    keepReceipt: 'Keep your receipt: Download it from your Orders page after payment.',
                    meetInspect: 'Meet and inspect',
                    payWallet: 'Pay with wallet: Pay only after you agree on the item, and only inside the platform.',
                    reportProblem: 'Report a problem within 24 hours'
                }
            },
            owner: {
                badge: 'This is your listing',
                previewAsBuyer: 'Preview as buyer (read-only)',
                listingActions: 'Manage listing',
                editListing: 'Edit listing',
                markSoldUnlist: 'Mark as sold / Unlist',
                relist: 'Relist listing',
                deleteListing: 'Delete listing',
                quantity: 'Quantity',
                status: 'Status',
                active: 'Active',
                soldOut: 'Sold out',
                hidden: 'Hidden',
                saveStock: 'Save stock and status',
                saving: 'Saving...',
                stockSaved: 'Listing stock and status updated.',
                invalidStock: 'Enter a valid whole-number quantity.',
                stockRequired: 'Active or hidden listings must have at least one item in stock.',
                updateFailed: 'Could not update the listing.',
                deleteFailed: 'Could not delete the listing.',
                deleting: 'Deleting...',
                confirmDeleteTitle: 'Delete this listing?',
                confirmDelete: 'This action cannot be undone. Listings with open orders or disputes cannot be deleted.',
                confirmDeleteAction: 'Delete listing',
                cancel: 'Cancel',
                listingStats: 'Listing stats',
                viewInquiries: 'View inquiries',
                inquiriesForProduct: 'Inquiries for product #{id}',
                clearFilter: 'Clear',
                stats: {
                    views: 'Views',
                    wishlist: 'Wishlists',
                    inquiries: 'Inquiries',
                    cart: 'Items in carts'
                },
                sellerSafetyTips: 'Seller safety tips',
                safety: {
                    inspect: 'Let the buyer inspect the item before paying.',
                    public: 'Meet in busy public areas only.',
                    wallet: 'Accept payment only through the in-app wallet, never outside the platform.'
                }
            }
        },
        auth: {
            campusPortal: 'Campus Portal',
            secureLoginDescription: 'This is a secure campus marketplace for academic essentials. Buy, sell, and trade safely with verified peers.',
            secureRegisterDescription: 'Your secure campus marketplace for academic essentials. Buy, sell, and trade safely with verified peers.',
            welcomeBack: 'Welcome Back',
            loginDescription: 'Sign in to your Campus Marketplace account.',
            createAccount: 'Create Your Account',
            registerDescription: 'Register for the Campus Marketplace.',
            studentId: 'Student ID',
            studentIdOrEmail: 'Student ID or Email',
            password: 'Password',
            fullName: 'Full Name',
            campusEmail: 'Campus Email',
            phoneNumber: 'Phone Number',
            college: 'College',
            department: 'Department',
            confirmPassword: 'Confirm Password',
            enterStudentId: 'Enter your student ID',
            enterStudentIdOrEmail: 'Enter your student ID or email',
            enterPassword: 'Enter your password',
            selectCollege: 'Select College',
            selectDepartment: 'Select Department',
            show: 'Show',
            hide: 'Hide',
            login: 'Login',
            signup: 'Signup',
            cancel: 'Cancel',
            forgotPassword: 'Forgot password?',
            createAccountLink: 'Create account',
            alreadyHaveAccount: 'Already have an account? Login',
            verifyCode: 'Verify Code',
            otpDescription: 'Enter the 6-digit code sent to the administrator email.',
            securedByChapa: 'Secured by Chapa Integration',
            verifiedStudents: 'Exclusively for Verified Students',
            terms: 'Terms of Service',
            privacy: 'Privacy Policy',
            needHelp: 'Need Help?',
            loginSuccessful: 'Login Successful!',
            couldNotConnect: 'Could not connect to server.',
            loginFailed: 'Login failed.',
            fillBoth: 'Please fill in both ID and password.',
            enterCode: 'Enter the 6-digit administrator verification code.',
            invalidCode: 'Invalid verification code.',
            couldNotVerify: 'Could not verify administrator login.',
            validEmail: 'Please enter a valid email address.',
            validPhone: 'Please enter a valid phone number (e.g., 0962714305).',
            enterName: 'Please enter your full name.',
            enterId: 'Please enter your student ID.',
            selectYourCollege: 'Please select your college.',
            selectYourDepartment: 'Please select your department.',
            passwordLength: 'Password must be at least 6 characters.',
            passwordsMismatch: 'Passwords do not match.',
            creatingAccount: 'Creating account…',
            registrationSuccess: 'Registration successful. You can now log in.',
            registrationFailed: 'Registration failed.',
            couldNotCreate: 'Could not create account.',
            oauthErrors: {
                domain_not_allowed: 'A personal Gmail address is not allowed while university email is required. Use an address ending in @{domain}.',
                account_pending: 'Your account is waiting for university approval. You can sign in after an administrator approves it.',
                email_not_verified: 'Google did not confirm this email address. Verify it with Google, then try again.',
                token_exchange_failed: 'Google could not complete sign-in. The authorization code may have expired; please try again.',
                google_state: 'This sign-in attempt expired or could not be verified. Please start again.',
                google_state_invalid: 'This Google sign-in attempt was already used or expired. Start a new sign-in.',
                google_invalid_grant: 'Google rejected the sign-in code because it expired or was already used. Start a new sign-in.',
                google_redirect_mismatch: 'Google sign-in redirect does not match the server configuration. Contact support.',
                google_invalid_client: 'Google sign-in client configuration is invalid. Contact support.',
                google_provider_unavailable: 'Google could not be reached to complete sign-in. Please try again shortly.',
                google_token_exchange_failed: 'Google could not complete sign-in. Please start a new sign-in.',
                google_cancelled: 'Google sign-in was cancelled. You can try again whenever you are ready.',
                identity_provider_unavailable: 'Google sign-in is temporarily unavailable. Please try again shortly.',
                identity_verification_failed: 'Google could not verify your identity. Please try again.',
                oauth_not_configured: 'Google sign-in is not configured on the server. Please contact support.',
                oauth_configuration_error: 'Google sign-in is misconfigured on the server. Please check the OAuth client and redirect URI settings.',
                account_unavailable: 'Your account could not be signed in. Please contact support.',
                session_restore_failed: 'Google signed you in, but this browser could not restore the session. Please try again.'
            }
        },
        studentToast: {
            profileSaved: 'Profile saved successfully.',
            preferencesSaved: 'Preferences saved',
            preferencesSaveFailed: 'Preferences could not be saved.',
            preferencesLoadFailed: 'Unable to load notification preferences.',
            savePreferences: 'Save Preferences',
            resetPreferences: 'Reset',
            savingPreferences: 'Saving…',
            unsavedPreferences: 'Unsaved changes',
            discardUnsavedPreferences: 'You have unsaved notification changes. Leave this tab without saving?',
            avatarUploaded: 'Profile photo updated successfully.',
            supportSubmitted: 'Support request submitted successfully.',
            wishlistAdded: 'Added to favorites.',
            cartAdded: 'Added to cart.',
            wishlistRemoved: 'Removed from favorites.',
            cartRemoved: 'Removed from cart.',
            cartUpdated: 'Cart updated successfully.',
            reviewSubmitted: 'Review submitted successfully.',
            disputeSubmitted: 'Dispute submitted successfully.',
            receiptConfirmed: 'Delivery confirmed successfully.',
            orderHidden: 'Order updated successfully.',
            paymentVerified: 'Payment confirmed and wallet updated.',
            paymentPending: 'Payment is still pending confirmation.',
            paymentFailed: 'Payment verification failed.',
            withdrawalSubmitted: 'Withdrawal request submitted.',
            orderPayoutReleased: 'Order #{orderId} completed. {netAmount} ETB was added to your wallet.',
            payoutAccountSaved: 'Payout account configured successfully.',
            productUpdated: 'Product updated successfully.',
            productDeleted: 'Product deleted successfully.',
            productListed: 'Product listed successfully.',
            messageDeleted: 'Message deleted successfully.',
            reportSubmitted: 'Report submitted successfully.',
            notificationsRead: 'Notifications marked as read.',
            notificationsDeleted: 'Notification deleted.',
            checkoutCompleted: 'Order placed successfully.',
            aiResponseReady: 'AI response received.',
            attachmentUploaded: 'Attachment sent successfully.',
            userBlocked: 'User blocked successfully.',
            userUnblocked: 'User unblocked successfully.',
            ownProductAction: 'You cannot buy or save your own product.'
        }
    },
    am: {
        home: {
            searchPlaceholderMobile: 'ምርቶችን ይፈልጉ…',
            searchPlaceholderFull: 'መጽሐፍት፣ ላፕቶፖች፣ የላቦራቶሪ ካባዎችን ይፈልጉ...',
            search: 'ፈልግ',
            searchMaterials: 'ቁሳቁሶችን ፈልግ',
            clearSearch: 'ፍለጋን አጽዳ',
            browseDirectory: 'ማውጫውን ይመልከቱ',
            allProducts: 'ሁሉም ምርቶች',
            resultsFor: 'የ “{query}” ውጤቶች',
            itemsFound: '{count} ምርቶች ተገኝተዋል',
            noProductsFound: 'ለ “{query}” ምንም ምርት አልተገኘም',
            noProductsAvailable: 'ምንም ምርት አልተገኘም።',
            listingsFailure: 'ምርቶችን ማምጣት አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
            listingsLoading: 'ገጹ እየተጫነ ነው፣ ትንሽ ይጠብቁ…',
            noConnection: 'ግንኙነት የለም። ኢንተርኔትዎን ያረጋግጡና እንደገና ይሞክሩ።',
            tryAgain: 'እንደገና ሞክር',
            dismiss: 'ዝጋ',
            developmentHint: 'የልማት ሁነታ፦ የጀርባ አገልጋዩን ያረጋግጡ።'
        },
        walletPayout: {
            accountLabel: 'የክፍያ መቀበያ መለያ፦',
            providerFallback: 'የተዋቀረ አቅራቢ',
            accountLoading: 'የክፍያ መለያው በመጫን ላይ…',
            accountRequired: 'ገንዘብ ለማውጣት የክፍያ መቀበያ መለያ ያዘጋጁ።',
            setupButton: 'የክፍያ መለያ ያዘጋጁ',
            setupTitle: 'የክፍያ መቀበያ መለያዎን ያዘጋጁ',
            method: 'የክፍያ ዘዴ',
            bank: 'ባንክ',
            mobileMoney: 'ሞባይል ገንዘብ',
            mobileProvider: 'የሞባይል ገንዘብ አቅራቢ',
            chooseProvider: 'አቅራቢ ይምረጡ',
            loadingBanks: 'አቅራቢዎችን በመጫን ላይ…',
            retryProviders: 'አቅራቢዎችን እንደገና ለመጫን ይሞክሩ',
            noProviders: 'ለዚህ ዘዴ የሚደገፍ አቅራቢ የለም።',
            holderName: 'የመለያ ባለቤት ስም',
            holderNameInvalid: 'የተለየው የክፍያ መለያ ስም የእርስዎ ወይም የተፈቀደ የቤተሰብ አባል መሆኑን ያረጋግጡ።',
            alternativeNameConsent: 'የዚህ የባንክ ሂሳብ ስም ከመገለጫ ስምዎ የተለየ ነው። ይህ ሂሳብ የእርስዎ ወይም የተፈቀደ የቤተሰብ አባል እንደሆነ ያረጋግጡ።',
            mobileNumber: 'የሞባይል ገንዘብ ቁጥር',
            accountNumber: 'የመለያ ቁጥር',
            mobileNumberInvalid: 'ትክክለኛ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ (09XXXXXXXX ወይም 07XXXXXXXX)።',
            accountNumberInvalid: 'ለዚህ ባንክ ትክክለኛ የመለያ ቁጥር ያስገቡ (10–15 አሃዞች)።',
            setupFieldsRequired: 'አቅራቢ ይምረጡ፣ የመለያ ባለቤት ስምና ቁጥር ያስገቡ።',
            setupLoadError: 'የሚደገፉ የክፍያ አቅራቢዎችን መጫን አልተቻለም።',
            setupFailed: 'የክፍያ መለያው አልተረጋገጠም። እንደገና ይሞክሩ።',
            authRequired: 'የክፍያ መለያ ለማዘጋጀት እንደገና ይግቡ።',
            verifiedRequired: 'የተረጋገጡ ተማሪዎች ብቻ የክፍያ መለያ ማዘጋጀት ይችላሉ።',
            changeAccount: 'የክፍያ መለያ ቀይር',
            saving: 'በማስቀመጥ ላይ…',
            saveAndContinue: 'አስቀምጥና ገንዘብ ማውጣቱን ቀጥል',
            cancel: 'ሰርዝ',
            processing: 'በማስኬድ ላይ…',
            submitWithdrawal: 'ገንዘብ ማውጣት አስገባ'
        },
        messages: {
            blockUser: 'ተጠቃሚውን አግድ',
            unblockUser: 'ተጠቃሚውን እገዳ አንሳ',
            confirmBlock: 'ይህን ተጠቃሚ ማገድ ይፈልጋሉ? በኋላ እገዳውን ማንሳት ይችላሉ።',
            conversationBlocked: 'በዚህ ውይይት ውስጥ መልዕክት መላክ አይችሉም።',
            messagingDisabled: 'መልዕክት መላክ ተሰናክሏል',
            typeMessage: 'መልዕክት ይጻፉ...'
        },
        productDetails: {
            loginRequired: 'መግባት ያስፈልጋል',
            loginPrompt: 'ለመቀጠል ይግቡ',
            login: 'ግባ',
            cancel: 'ሰርዝ',
            buyer: {
                handover: 'የርክክብ ቦታ',
                availableHours: 'የሚገኙበት ሰዓት',
                posted: 'የተለጠፈው',
                recently: 'በቅርቡ',
                peopleViewed: 'ሰዎች ይህን ዝርዝር አይተዋል',
                sellerRating: 'የሻጭ ደረጃ',
                reviews: 'ግምገማዎች',
                noSellerReviews: 'እስካሁን ደረጃ የለም',
                itemsSold: 'የተሸጡ እቃዎች',
                memberSince: 'አባል የሆነበት ጊዜ',
                responseTime: 'የተለመደ የምላሽ ጊዜ',
                responseUnderHour: 'ከ1 ሰዓት በታች',
                responseWithinFewHours: 'በጥቂት ሰዓታት ውስጥ',
                responseWithinDay: 'በአንድ ቀን ውስጥ',
                responseWithinFewDays: 'በጥቂት ቀናት ውስጥ',
                responseHours: 'ሰዓታት',
                responseUnavailable: 'እስካሁን መረጃ የለም',
                moreFromSeller: 'ከዚህ ሻጭ ተጨማሪ',
                similarProducts: 'ተመሳሳይ ምርቶች',
                similarProductsError: 'ተመሳሳይ ምርቶችን መጫን አልተቻለም።',
                similarProductsRetry: 'እንደገና ይሞክሩ',
                soldOut: 'ተሽጧል',
                category: 'ምድብ',
                howBuyingWorks: 'ግዢ እንዴት ይሰራል',
                protectionNote: 'እቃውን ከመመርመርዎ በኋላ ብቻ ይክፈሉ።',
                sendMessage: 'መልዕክት ላክ',
                steps: {
                    chat: 'ውይይት፦ እቃው መኖሩን፣ ዋጋውን፣ የመገናኛ ቦታና ሰዓትን ይስማሙ።',
                    checkItem: 'እቃውን ያረጋግጡ፦ ከፎቶዎቹና ከመግለጫው ጋር መጣጣሙን ያረጋግጡ።',
                    keepReceipt: 'ደረሰኝዎን ይያዙ፦ ከከፈሉ በኋላ ከትዕዛዞች ገጽዎ ያውርዱት።',
                    meetInspect: 'ተገናኝተው እቃውን ይመርምሩ',
                    payWallet: 'በኪስ ቦርሳ ይክፈሉ፦ በእቃው ላይ ከተስማሙ በኋላ ብቻ፣ እና በመድረኩ ውስጥ ብቻ ይክፈሉ።',
                    reportProblem: 'ችግር ካለ በ24 ሰዓታት ውስጥ ያሳውቁ'
                }
            },
            owner: {
                badge: 'ይህ የእርስዎ ዝርዝር ነው',
                previewAsBuyer: 'እንደ ገዢ ቅድመ እይታ (ማንበብ ብቻ)',
                listingActions: 'ዝርዝሩን ያስተዳድሩ',
                editListing: 'ዝርዝሩን ያርትዑ',
                markSoldUnlist: 'እንደተሸጠ ምልክት ያድርጉ / ከዝርዝር ያውጡ',
                relist: 'ዝርዝሩን እንደገና ያቅርቡ',
                deleteListing: 'ዝርዝሩን ሰርዝ',
                quantity: 'ብዛት',
                status: 'ሁኔታ',
                active: 'ንቁ',
                soldOut: 'ተሽጧል',
                hidden: 'ተደብቋል',
                saveStock: 'ክምችትና ሁኔታ አስቀምጥ',
                saving: 'በማስቀመጥ ላይ...',
                stockSaved: 'የዝርዝሩ ክምችትና ሁኔታ ተዘምኗል።',
                invalidStock: 'ትክክለኛ ሙሉ ቁጥር ያስገቡ።',
                stockRequired: 'ንቁ ወይም የተደበቀ ዝርዝር ቢያንስ አንድ እቃ በክምችት ሊኖረው ይገባል።',
                updateFailed: 'ዝርዝሩን ማዘመን አልተቻለም።',
                deleteFailed: 'ዝርዝሩን መሰረዝ አልተቻለም።',
                deleting: 'በመሰረዝ ላይ...',
                confirmDeleteTitle: 'ይህን ዝርዝር ይሰርዙ?',
                confirmDelete: 'ይህ ተግባር መመለስ አይቻልም። ክፍት ትዕዛዞች ወይም ክርክሮች ያሏቸው ዝርዝሮች መሰረዝ አይችሉም።',
                confirmDeleteAction: 'ዝርዝሩን ሰርዝ',
                cancel: 'ሰርዝ',
                listingStats: 'የዝርዝሩ ስታቲስቲክስ',
                viewInquiries: 'ጥያቄዎችን ይመልከቱ',
                inquiriesForProduct: 'ለምርት #{id} የተላኩ ጥያቄዎች',
                clearFilter: 'አጽዳ',
                stats: {
                    views: 'እይታዎች',
                    wishlist: 'የተወደዱ',
                    inquiries: 'ጥያቄዎች',
                    cart: 'በጋሪ ውስጥ ያሉ እቃዎች'
                },
                sellerSafetyTips: 'የሻጭ ደህንነት ምክሮች',
                safety: {
                    inspect: 'ከመክፈሉ በፊት ገዢው እቃውን እንዲመረምር ይፍቀዱ።',
                    public: 'በተጨናነቁ የህዝብ ቦታዎች ብቻ ይገናኙ።',
                    wallet: 'ክፍያን በመተግበሪያው የኪስ ቦርሳ ብቻ ይቀበሉ፤ ከመድረኩ ውጭ በፍጹም አይቀበሉ።'
                }
            }
        },
        sellerHub: {
            productManagement: 'የምርት አስተዳደር',
            backToOverview: 'ወደ አጠቃላይ እይታ ተመለስ',
            inventoryTotal: 'ጠቅላላ',
            inventoryActive: 'ንቁ',
            inventorySold: 'የተሸጠ',
            inventoryPending: 'በመጠባበቅ ላይ',
            productsLoading: 'ምርቶችን በመጫን ላይ',
            productsLoadError: 'ምርቶችዎን መጫን አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
            retryProducts: 'እንደገና ሞክር',
            productsPagination: 'የምርት ገጾች',
            productsPreviousPage: 'ቀዳሚ ገጽ',
            productsNextPage: 'ቀጣይ ገጽ',
            productsPage: 'ገጽ {page}',
            productsShowing: 'ከ {total} ምርቶች {start}-{end} በማሳየት ላይ',
            salesAnalytics: 'የሽያጭ ትንታኔ',
            salesPerformance: 'የሽያጭ አፈጻጸም',
            salesRange7d: '7 ቀናት',
            salesRange30d: '30 ቀናት',
            salesRange3m: '3 ወራት',
            salesRangeTotals: 'ገቢ፡ {revenue} · ትዕዛዞች፡ {orders}',
            salesRevenueTrend: 'የሽያጭ ገቢ አዝማሚያ',
            salesLoading: 'ሽያጮችን በመጫን ላይ…',
            salesNoSales: 'በዚህ ጊዜ ሽያጭ የለም',
            salesLoadError: 'የሽያጭ ትንታኔን መጫን አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
            salesRetry: 'እንደገና ሞክር'
        },
        sellerOrders: {
            history: 'የትዕዛዝ ታሪክ',
            completedOrders: 'የተጠናቀቁ ትዕዛዞች',
            orderCount: '{count} ትዕዛዞች',
            search: 'ፈልግ',
            searchPlaceholder: 'የምርት ወይም የደንበኛ ስም',
            dateFrom: 'ከዚህ ቀን ጀምሮ',
            dateTo: 'እስከዚህ ቀን',
            loading: 'የተጠናቀቁ ትዕዛዞችን በመጫን ላይ',
            retry: 'እንደገና ሞክር',
            noCompletedOrders: 'ገና የተጠናቀቁ ትዕዛዞች የሉም።',
            noMatchingOrders: 'ከእነዚህ ማጣሪያዎች ጋር የሚዛመድ ትዕዛዝ የለም።',
            order: 'ትዕዛዝ',
            customer: 'ደንበኛ',
            product: 'ምርት',
            amount: 'መጠን',
            status: 'ሁኔታ',
            completed: 'የተጠናቀቀበት',
            actions: 'ድርጊቶች',
            openOrder: 'የተጠናቀቀውን ትዕዛዝ ይመልከቱ',
            sold: 'ተሽጧል',
            view: 'ይመልከቱ',
            pageOf: 'ገጽ {page} ከ {pages}',
            previous: 'የቀድሞ',
            next: 'ቀጣይ',
            detailsTitle: 'የትዕዛዝ ዝርዝሮች',
            backToOrders: 'ወደ ትዕዛዞች ተመለስ',
            productDetails: 'ምርት',
            description: 'መግለጫ',
            category: 'ምድብ',
            quantity: 'ብዛት',
            unitPrice: 'የአንዱ ዋጋ',
            payment: 'ክፍያ',
            itemPrice: 'የዕቃ ዋጋ',
            fees: 'ክፍያዎች',
            totalReceived: 'ጠቅላላ የተቀበሉት',
            paymentStatus: 'የክፍያ ሁኔታ',
            paymentTime: 'የክፍያ ጊዜ',
            buyer: 'ገዢ',
            department: 'ዲፓርትመንት',
            verifiedStudent: 'የተረጋገጠ ተማሪ',
            timeline: 'የጊዜ ሂደት',
            orderCreated: 'ትዕዛዝ ተፈጠረ',
            paymentCompleted: 'ክፍያ ተጠናቋል',
            orderCompleted: 'ትዕዛዝ ተጠናቋል',
            openChat: 'ውይይት ክፈት',
            dispute: 'ቅሬታ',
            noIssues: 'ምንም ችግር አልተዘገበም።',
            reportWindowTime: 'ችግር ለማሳወቅ የቀረው ጊዜ',
            reportWindowClosed: 'ችግር ለማሳወቅ የተፈቀደው ጊዜ አልፏል።',
            responseRemaining: 'ምላሽ ለመስጠት የቀረው ጊዜ',
            respond: 'ምላሽ ስጥ',
            responseText: 'የእርስዎ ምላሽ',
            responsePlaceholder: 'ለገዢው ሪፖርት የሚሰጡትን ምላሽ ይግለጹ',
            evidence: 'ማስረጃ',
            submitResponse: 'ምላሽ አስገባ',
            cancel: 'ሰርዝ',
            retryDetails: 'ዝርዝሮችን እንደገና ጫን',
            unavailable: 'አይገኝም'
        },
        adminReports: {
            title: 'የቅሬታ መፍቻ',
            close: 'ዝጋ',
            notSpecified: 'አልተገለጸም',
            notRecorded: 'አልተመዘገበም',
            years: 'ዓመታት',
            months: 'ወራት',
            days: 'ቀናት',
            reporter: 'አቤቱታ አቅራቢ',
            studentId: 'የተማሪ መለያ',
            reportCount: 'የቀድሞ ቅሬታዎች',
            verified: 'የተረጋገጠ ተማሪ',
            yes: 'አዎ',
            no: 'አይ',
            accountAge: 'የመለያ ዕድሜ',
            reportedSeller: 'የተጠቀሰው ሻጭ',
            complaints: 'የቅሬታ ብዛት',
            rating: 'ደረጃ',
            noRatings: 'ደረጃ የለም',
            walletStatus: 'የትዕዛዝ የኪስ ቦርሳ ሁኔታ',
            product: 'ምርት',
            order: 'ትዕዛዝ',
            paidAmount: 'የተከፈለ መጠን',
            complaintType: 'የቅሬታ አይነት',
            status: 'ሁኔታ',
            reviewedBy: 'የገመገመው',
            issueDetails: 'የችግሩ ዝርዝር',
            sellerResponse: 'የሻጩ ምላሽ',
            sellerResponsePhoto: 'የሻጩ ማስረጃ',
            appeal: 'ይግባኝ',
            loadingContext: 'የቅሬታ ዝርዝሮችን በመጫን ላይ…',
            viewEvidence: 'የማስረጃ ፎቶ ይመልከቱ',
            loadingLogs: 'ውይይቱን በመጫን ላይ…',
            viewConversation: 'የውይይት መዝገቦችን ይመልከቱ',
            resolvedDecision: 'ውሳኔ',
            decision: 'የአስተዳዳሪ ውሳኔ',
            selectDecision: 'ውሳኔ ይምረጡ',
            warning: 'ማስጠንቀቂያ',
            removeProduct: 'ምርትን አስወግድ',
            suspendUser: 'ተጠቃሚን አግድ',
            refund: 'ተመላሽ ክፍያ',
            reject: 'ውድቅ አድርግ',
            refundOrder: 'የተመላሽ ትዕዛዝ',
            refundAmount: 'የተመላሽ መጠን (ETB)',
            refundAmountError: 'ከዜሮ በላይና ከተከፈለው መጠን ያልበለጠ ያስገቡ።',
            refundRequiresOrder: 'ተመላሽ ክፍያ ከተከፈለ ትዕዛዝ ጋር ለተያያዙ ቅሬታዎች ብቻ ይቻላል።',
            confirmEffect: 'ይህን ተግባርና ውጤቱን ያረጋግጡ፦',
            takeOverConfirm: 'የዚህን ቅሬታ ግምገማ ይቆጣጠሩ?',
            resolveError: 'ቅሬታውን መፍታት አልተቻለም።',
            reviewError: 'ቅሬታውን ለግምገማ መክፈት አልተቻለም።',
            contextError: 'የቅሬታ ዝርዝሮችን መጫን አልተቻለም።',
            openingReview: 'ቅሬታውን ለግምገማ በመክፈት ላይ…',
            reason: 'የጽሑፍ ምክንያት (አስፈላጊ)',
            reasonPlaceholder: 'ውሳኔውንና መሠረቱን ያብራሩ።',
            reasonMinLength: 'ቢያንስ 10 ቁምፊዎች',
            resolving: 'በመፍታት ላይ…',
            resolve: 'ፍታ',
            resolved: 'ቅሬታው በተሳካ ሁኔታ ተፈቷል።'
        },
        sellerReportInbox: {
            title: 'ቅሬታዎች',
            authRequired: 'የቅሬታ እርምጃዎችን ለመጫን እንደገና ይግቡ።',
            loadError: 'የቅሬታ እርምጃዎችን መጫን አልተቻለም።',
            submitError: 'የቅሬታ ምላሽዎን ማስገባት አልተቻለም።',
            report: 'ቅሬታ',
            responseSubmitted: 'የቀረበ ምላሽ',
            decision: 'ውሳኔ',
            response: 'የአንድ ጊዜ ምላሽ (በ48 ሰዓት ውስጥ)',
            photo: 'አማራጭ ፎቶ ያያይዙ',
            submitting: 'በማስገባት ላይ…',
            submitResponse: 'ምላሽ አስገባ',
            appeal: 'የአንድ ጊዜ ይግባኝ',
            submitAppeal: 'ይግባኝ አስገባ'
        },
        studentToast: {
            preferencesSaved: 'ምርጫዎች ተቀምጠዋል',
            preferencesSaveFailed: 'ምርጫዎችን ማስቀመጥ አልተቻለም።',
            preferencesLoadFailed: 'የማሳወቂያ ምርጫዎችን መጫን አልተቻለም።',
            savePreferences: 'ምርጫዎችን አስቀምጥ',
            resetPreferences: 'ዳግም አስጀምር',
            savingPreferences: 'በማስቀመጥ ላይ…',
            unsavedPreferences: 'ያልተቀመጡ ለውጦች',
            discardUnsavedPreferences: 'ያልተቀመጡ የማሳወቂያ ለውጦች አሉ። ሳያስቀምጡ ከዚህ ትር መውጣት ይፈልጋሉ?',
            ownProductAction: 'የራስዎን ምርት መግዛት ወይም ወደ ተወዳጆች ማስቀመጥ አይችሉም።',
            notificationsRead: 'ማሳወቂያዎች እንደተነበቡ ተመልክተዋል።',
            notificationsDeleted: 'ማሳወቂያ ተሰርዟል።',
            payoutAccountSaved: 'የክፍያ መለያ በተሳካ ሁኔታ ተዋቅሯል።',
            userBlocked: 'ተጠቃሚው ታግዷል።',
            userUnblocked: 'የተጠቃሚው እገዳ ተነስቷል።'
        },
        auth: {
            oauthErrors: {
                domain_not_allowed: 'የዩኒቨርሲቲ ኢሜይል ሲያስፈልግ የግል Gmail አድራሻ አይፈቀድም። @{domain} የሚያበቃ አድራሻ ይጠቀሙ።',
                account_pending: 'መለያዎ የዩኒቨርሲቲ ፈቃድ እየጠበቀ ነው። አስተዳዳሪ ካጸደቀው በኋላ መግባት ይችላሉ።',
                email_not_verified: 'Google ይህን ኢሜይል አላረጋገጠም። በGoogle ያረጋግጡትና እንደገና ይሞክሩ።',
                token_exchange_failed: 'Google መግባትን ማጠናቀቅ አልቻለም። የፈቃድ ኮዱ ጊዜው አልፎ ሊሆን ይችላል፤ እንደገና ይሞክሩ።',
                google_state: 'ይህ የመግቢያ ሙከራ ጊዜው አልፎታል ወይም ማረጋገጥ አልተቻለም። እባክዎ እንደገና ይጀምሩ።',
                google_state_invalid: 'ይህ የGoogle መግቢያ ሙከራ አስቀድሞ ተጠቅሟል ወይም ጊዜው አልፎታል። አዲስ የመግቢያ ሙከራ ይጀምሩ።',
                google_invalid_grant: 'Google የመግቢያ ኮዱን አልተቀበለም፤ ጊዜው አልፎታል ወይም አስቀድሞ ተጠቅሟል። አዲስ ይጀምሩ።',
                google_redirect_mismatch: 'የGoogle መግቢያ የመመለሻ አድራሻ ከአገልጋዩ ቅንብር ጋር አይዛመድም። ድጋፍን ያነጋግሩ።',
                google_invalid_client: 'የGoogle መግቢያ የደንበኛ ቅንብር ልክ አይደለም። ድጋፍን ያነጋግሩ።',
                google_provider_unavailable: 'Google መግቢያን ለመጨረስ ማግኘት አልተቻለም። ቆይተው እንደገና ይሞክሩ።',
                google_token_exchange_failed: 'Google መግባትን ማጠናቀቅ አልቻለም። አዲስ የመግቢያ ሙከራ ይጀምሩ።',
                google_cancelled: 'የGoogle መግቢያ ተሰርዟል። ሲፈልጉ እንደገና መሞከር ይችላሉ።',
                identity_provider_unavailable: 'የGoogle መግቢያ ለጊዜው አይገኝም። ቆይተው እንደገና ይሞክሩ።',
                identity_verification_failed: 'Google ማንነትዎን ማረጋገጥ አልቻለም። እንደገና ይሞክሩ።',
                oauth_not_configured: 'የGoogle መግቢያ በአገልጋዩ ላይ አልተዋቀረም። ድጋፍን ያነጋግሩ።',
                oauth_configuration_error: 'በአገልጋዩ ላይ የGoogle መግቢያ ቅንብር ችግር አለ። የOAuth ደንበኛና የመመለሻ ዩአርአይ ቅንብሮችን ያረጋግጡ።',
                account_unavailable: 'ወደ መለያዎ መግባት አልተቻለም። ድጋፍን ያነጋግሩ።',
                session_restore_failed: 'Google ገብተው ነበር፣ ግን ክፍለ ጊዜውን ማስመለስ አልተቻለም። እንደገና ይሞክሩ።'
            }
        }
    },
};

const LanguageContext = createContext(null);

function getTranslation(dictionary, key) {
    return key.split('.').reduce((value, part) => value?.[part], dictionary);
}

export function LanguageProvider({ children }) {
    const [language, setLanguage] = useState(() => (
        typeof window !== 'undefined' ? getSavedLanguage() : 'en'
    ));
    const languageRef = useRef(language);

    useEffect(() => {
        const initializeGoogleTranslate = () => {
            if (!window.google?.translate?.TranslateElement) return;

            if (!document.querySelector('#google_translate_element .goog-te-combo')) {
                new window.google.translate.TranslateElement({
                    pageLanguage: 'en',
                    includedLanguages: 'en,am',
                    autoDisplay: false,
                }, 'google_translate_element');
            }

            applyGoogleLanguage(languageRef.current);
        };

        window.googleTranslateElementInit = initializeGoogleTranslate;
        const loadGoogleTranslate = () => {
            if (language !== 'am' || !navigator.onLine) return;

            if (window.google?.translate?.TranslateElement) {
                initializeGoogleTranslate();
                return;
            }

            if (document.getElementById(GOOGLE_TRANSLATE_SCRIPT_ID)) return;

            const translateScript = document.createElement('script');
            translateScript.id = GOOGLE_TRANSLATE_SCRIPT_ID;
            translateScript.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
            translateScript.async = true;
            translateScript.onerror = () => translateScript.remove();
            document.body.appendChild(translateScript);
        };

        loadGoogleTranslate();
        window.addEventListener('online', loadGoogleTranslate);

        const handleRenderedContent = () => {
            if (languageRef.current === 'am') applyGoogleLanguage('am');
        };
        window.addEventListener('campace:content-rendered', handleRenderedContent);
        return () => {
            window.removeEventListener('online', loadGoogleTranslate);
            window.removeEventListener('campace:content-rendered', handleRenderedContent);
        };
    }, [language]);

    const changeLanguage = useCallback((nextLanguage) => {
        const selectedLanguage = nextLanguage === 'am' ? 'am' : 'en';
        languageRef.current = selectedLanguage;
        setLanguage(selectedLanguage);
        try {
            window.localStorage.setItem(LANGUAGE_STORAGE_KEY, selectedLanguage);
        } catch {
            // Translation still works for this page view if storage is unavailable.
        }
        applyGoogleLanguage(selectedLanguage);
    }, []);

    const value = useMemo(() => ({
        language,
        setLanguage: changeLanguage,
        t: (key) => getTranslation(translations[language] || {}, key)
            ?? getTranslation(translations.en, key)
            ?? key
    }), [changeLanguage, language]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
    return context;
}