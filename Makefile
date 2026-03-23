LIBDIR := lib
include $(LIBDIR)/main.mk

.PHONY: codepoints apply-codepoints update-quic-pick

codepoints: codepoints/quic-pick/quic-pick.js
	node codepoints/pick-codepoints.js

apply-codepoints:
	node codepoints/apply-codepoints.js

update-quic-pick:
	git submodule update --remote codepoints/quic-pick
	@echo "quic-pick submodule updated — review and commit if changed"

codepoints/quic-pick/quic-pick.js:
	git submodule update --init codepoints/quic-pick

$(LIBDIR)/main.mk:
ifneq (,$(shell grep "path *= *$(LIBDIR)" .gitmodules 2>/dev/null))
	git submodule sync
	git submodule update $(CLONE_ARGS) --init
else
	git clone -q --depth 10 $(CLONE_ARGS) \
	    -b main https://github.com/martinthomson/i-d-template $(LIBDIR)
endif
