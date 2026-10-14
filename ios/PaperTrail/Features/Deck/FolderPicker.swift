// Owner: deck. The folder picker pushed from card detail's Folder row (docs/design-spec.md 4.13) and
// from the check-fields sheet's "Choose another folder" (3.8).
import SwiftUI

/// The 11 folders by display name, checkmark on the current one (4.13). Pops on choice.
struct FolderPicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List(ArchiveFolder.all, id: \.self) { folder in
            Button {
                selection = folder
                dismiss()
            } label: {
                HStack {
                    Text(DeckFormat.folderName(folder)).foregroundStyle(.primary)
                    Spacer()
                    if folder == selection {
                        Image(systemName: "checkmark").foregroundStyle(Color(.accent)).fontWeight(.semibold)
                    }
                }
            }
            .accessibilityAddTraits(folder == selection ? .isSelected : [])
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Folder")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
}
