LIBDIR := lib
include $(LIBDIR)/main.mk

.PHONY: pick-codepoints apply-codepoints pick-and-apply-codepoints update-quic-pick

# Derive codepoints for the next draft version and append them to codepoints.md
pick-codepoints: update-quic-pick
	node codepoints/pick-codepoints.js

# Substitute updated codepoint values from codepoints.md into the draft
apply-codepoints:
	node codepoints/apply-codepoints.js

# Pick codepoints and apply them to the draft in one step
pick-and-apply-codepoints: pick-codepoints apply-codepoints

# Update the quic-pick submodule to the latest upstream commit
update-quic-pick:
	git submodule update --init --remote codepoints/quic-pick
	@echo "quic-pick submodule updated — review and commit if changed"

$(LIBDIR)/main.mk:
ifneq (,$(shell grep "path *= *$(LIBDIR)" .gitmodules 2>/dev/null))
	git submodule sync
	git submodule update $(CLONE_ARGS) --init
else
	git clone -q --depth 10 $(CLONE_ARGS) \
	    -b main https://github.com/martinthomson/i-d-template $(LIBDIR)
endif
