import Contacts
import Foundation

struct ContactEntry: Identifiable, Hashable {
    let id: String
    let fullName: String
    let organization: String
    let phones: [String]
    let emails: [String]

    var displayName: String {
        if !fullName.isEmpty { return fullName }
        if !organization.isEmpty { return organization }
        return "Unnamed Contact"
    }

    var incompleteReason: String? {
        let hasName = !fullName.isEmpty || !organization.isEmpty
        let hasReachability = !phones.isEmpty || !emails.isEmpty
        if !hasName && !hasReachability {
            return "Empty contact (no name, phone, or email)"
        } else if !hasName {
            return "Missing contact name"
        } else if !hasReachability {
            return "No phone number or email address"
        }
        return nil
    }
}

struct ContactDuplicateGroup: Identifiable, Hashable {
    let id: String
    let reason: String
    let contacts: [ContactEntry]
}

struct ContactsScanResult {
    var duplicateGroups: [ContactDuplicateGroup] = []
    var incompleteContacts: [ContactEntry] = []
    var totalContactsScanned: Int = 0
}

typealias ContactsScanner = ContactsCleaner

enum ContactsCleaner {
    static func requestAccess() async -> Bool {
        let store = CNContactStore()
        return (try? await store.requestAccess(for: .contacts)) ?? false
    }

    static func scan() async -> [ContactDuplicateGroup] {
        let full = await scanAll()
        return full.duplicateGroups
    }

    static func scanAll() async -> ContactsScanResult {
        await Task.detached(priority: .userInitiated) {
            performScan()
        }.value
    }

    /// Smart merges all contacts in a duplicate group into the primary entry (preserving all unique
    /// phone numbers, email addresses, organization details, and postal addresses) and deletes the duplicates.
    static func merge(group: ContactDuplicateGroup) async throws {
        guard group.contacts.count >= 2 else { return }
        let store = CNContactStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactMiddleNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPostalAddressesKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor
        ]
        let identifiers = group.contacts.map(\.id)
        let predicate = CNContact.predicateForContacts(withIdentifiers: identifiers)
        let fetched = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
        guard let primary = fetched.first?.mutableCopy() as? CNMutableContact else { return }

        var existingPhones = Set(primary.phoneNumbers.map { normalizePhone($0.value.stringValue) })
        var existingEmails = Set(primary.emailAddresses.map { ($0.value as String).lowercased() })

        let saveRequest = CNSaveRequest()
        for duplicate in fetched.dropFirst() {
            if primary.givenName.isEmpty && !duplicate.givenName.isEmpty {
                primary.givenName = duplicate.givenName
            }
            if primary.familyName.isEmpty && !duplicate.familyName.isEmpty {
                primary.familyName = duplicate.familyName
            }
            if primary.organizationName.isEmpty && !duplicate.organizationName.isEmpty {
                primary.organizationName = duplicate.organizationName
            }
            if primary.jobTitle.isEmpty && !duplicate.jobTitle.isEmpty {
                primary.jobTitle = duplicate.jobTitle
            }
            if primary.birthday == nil && duplicate.birthday != nil {
                primary.birthday = duplicate.birthday
            }

            for phone in duplicate.phoneNumbers {
                let norm = normalizePhone(phone.value.stringValue)
                if !norm.isEmpty && !existingPhones.contains(norm) {
                    existingPhones.insert(norm)
                    primary.phoneNumbers.append(phone)
                }
            }
            for email in duplicate.emailAddresses {
                let norm = (email.value as String).lowercased()
                if !norm.isEmpty && !existingEmails.contains(norm) {
                    existingEmails.insert(norm)
                    primary.emailAddresses.append(email)
                }
            }
            if primary.postalAddresses.isEmpty && !duplicate.postalAddresses.isEmpty {
                primary.postalAddresses.append(contentsOf: duplicate.postalAddresses)
            }

            if let mutableDup = duplicate.mutableCopy() as? CNMutableContact {
                saveRequest.delete(mutableDup)
            }
        }
        saveRequest.update(primary)
        try store.execute(saveRequest)
    }

    /// Deletes incomplete contacts by identifier using `CNSaveRequest`.
    static func deleteIncompleteContacts(identifiers: [String]) async throws -> Int {
        guard !identifiers.isEmpty else { return 0 }
        return try await Task.detached(priority: .userInitiated) {
            let store = CNContactStore()
            let keys: [CNKeyDescriptor] = [CNContactIdentifierKey as CNKeyDescriptor]
            let predicate = CNContact.predicateForContacts(withIdentifiers: identifiers)
            let fetched = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
            guard !fetched.isEmpty else { return 0 }

            let saveRequest = CNSaveRequest()
            var deleted = 0
            for contact in fetched {
                if let mutable = contact.mutableCopy() as? CNMutableContact {
                    saveRequest.delete(mutable)
                    deleted += 1
                }
            }
            if deleted > 0 {
                try store.execute(saveRequest)
            }
            return deleted
        }.value
    }

    private static func performScan() -> ContactsScanResult {
        let store = CNContactStore()
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var all: [ContactEntry] = []

        try? store.enumerateContacts(with: request) { contact, _ in
            let name = "\(contact.givenName) \(contact.familyName)"
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let org = contact.organizationName.trimmingCharacters(in: .whitespacesAndNewlines)
            let phones = contact.phoneNumbers.map { $0.value.stringValue }
            let emails = contact.emailAddresses.map { $0.value as String }
            all.append(
                ContactEntry(
                    id: contact.identifier,
                    fullName: name,
                    organization: org,
                    phones: phones,
                    emails: emails
                )
            )
        }

        var usedIDs = Set<String>()
        var groups: [ContactDuplicateGroup] = []

        // 1. Group by normalized phone number (last 10 digits or full digits >= 7)
        var byPhone: [String: [ContactEntry]] = [:]
        for entry in all {
            for phone in entry.phones {
                let norm = normalizePhone(phone)
                if norm.count >= 7 {
                    byPhone[norm, default: []].append(entry)
                }
            }
        }
        for (phone, list) in byPhone {
            let unique = uniqueEntries(list).filter { !usedIDs.contains($0.id) }
            if unique.count >= 2 {
                unique.forEach { usedIDs.insert($0.id) }
                groups.append(
                    ContactDuplicateGroup(
                        id: "phone:\(phone)",
                        reason: "Shared phone \(phone)",
                        contacts: unique
                    )
                )
            }
        }

        // 2. Group by normalized email address
        var byEmail: [String: [ContactEntry]] = [:]
        for entry in all where !usedIDs.contains(entry.id) {
            for email in entry.emails {
                let norm = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if !norm.isEmpty {
                    byEmail[norm, default: []].append(entry)
                }
            }
        }
        for (email, list) in byEmail {
            let unique = uniqueEntries(list).filter { !usedIDs.contains($0.id) }
            if unique.count >= 2 {
                unique.forEach { usedIDs.insert($0.id) }
                groups.append(
                    ContactDuplicateGroup(
                        id: "email:\(email)",
                        reason: "Shared email \(email)",
                        contacts: unique
                    )
                )
            }
        }

        // 3. Group by normalized full name
        var byName: [String: [ContactEntry]] = [:]
        for entry in all where !usedIDs.contains(entry.id) && !entry.fullName.isEmpty {
            byName[entry.fullName.lowercased(), default: []].append(entry)
        }
        for (name, list) in byName {
            let unique = uniqueEntries(list).filter { !usedIDs.contains($0.id) }
            if unique.count >= 2 {
                unique.forEach { usedIDs.insert($0.id) }
                groups.append(
                    ContactDuplicateGroup(
                        id: "name:\(name)",
                        reason: "Duplicate name \(unique[0].fullName)",
                        contacts: unique
                    )
                )
            }
        }

        // 4. Incomplete contacts (missing name or missing both phone and email)
        let incomplete = all.filter { $0.incompleteReason != nil }

        return ContactsScanResult(
            duplicateGroups: groups,
            incompleteContacts: incomplete,
            totalContactsScanned: all.count
        )
    }

    private static func uniqueEntries(_ entries: [ContactEntry]) -> [ContactEntry] {
        var seen = Set<String>()
        return entries.filter { seen.insert($0.id).inserted }
    }

    private static func normalizePhone(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        if digits.count > 10 {
            return String(digits.suffix(10))
        }
        return digits
    }
}
